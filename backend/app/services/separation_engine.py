import base64
import os
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple
import wave
import subprocess
import tempfile
import asyncio
import shutil
import sys

import httpx

from app.models import Algorithm

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SeparationResult:
    """
    统一的分离结果结构：把 stems 写到本地 results_dir 后返回路径映射 +（可选）客观指标。
    """

    stems: Dict[str, Path]  # stem_name -> wav path
    sdr: Optional[float] = None
    sir: Optional[float] = None
    sar: Optional[float] = None
    comment: Optional[str] = None


class SeparationEngine:
    async def separate(
        self, *, input_path: Path, algorithm: Algorithm, results_dir: Path
    ) -> SeparationResult:
        raise NotImplementedError


@dataclass(frozen=True)
class _MSSModelSpec:
    """Music-Source-Separation-Training 模型配置"""

    # README 中的 key，例如 mdx23c、htdemucs、bs_roformer、scnet
    model_type: str
    # 默认的 config 文件路径（相对于 MSS 仓库 configs 目录）
    default_config: str
    # 可选：覆盖 config 路径的环境变量名，例如 MSS_MDX23C_CONFIG
    config_env: str
    # 必填：权重 ckpt 路径的环境变量名，例如 MSS_MDX23C_CKPT
    ckpt_env: str


class MockSeparationEngine(SeparationEngine):
    async def separate(
        self, *, input_path: Path, algorithm: Algorithm, results_dir: Path
    ) -> SeparationResult:
        results_dir.mkdir(parents=True, exist_ok=True)
        stem_names = ["Vocals", "Drums", "Bass", "Other"]
        stems: Dict[str, Path] = {}

        # 为了让"可视化分析/播放"更接近真实链路：mock 也输出可听的 WAV
        # 做法：用 ffmpeg 对输入音频进行不同的处理，为每个 stem 生成不同的音频内容
        with tempfile.TemporaryDirectory(prefix="audiolab_mock_") as td:
            base_wav = Path(td) / "base.wav"
            cmd_base = [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(input_path),
                "-ac",
                "1",
                "-ar",
                "44100",
                "-acodec",
                "pcm_s16le",
                str(base_wav),
            ]
            proc_base = subprocess.run(cmd_base, capture_output=True, text=True)

            if proc_base.returncode == 0 and base_wav.exists() and base_wav.stat().st_size > 0:
                # 为每个 stem 生成不同的音频内容
                stem_filters = {
                    "Vocals": "highpass=f=200,volume=0.8",  # 高通滤波，保留高频（人声）
                    "Bass": "lowpass=f=300,volume=0.9",     # 低通滤波，保留低频（贝斯）
                    "Drums": "bandpass=f=2000:w=3000,volume=0.85",  # 带通滤波，保留中频（鼓）
                    "Other": "volume=0.7,treble=g=-5",       # 降低高音，模拟其他乐器
                }
                
                for stem_name in stem_names:
                    stem_path = results_dir / f"{stem_name}.wav"
                    filter_complex = stem_filters.get(stem_name, "volume=0.8")
                    
                    cmd_stem = [
                        "ffmpeg",
                        "-y",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-i",
                        str(base_wav),
                        "-af",
                        filter_complex,
                        "-ac",
                        "1",
                        "-ar",
                        "44100",
                        "-acodec",
                        "pcm_s16le",
                        str(stem_path),
                    ]
                    proc_stem = subprocess.run(cmd_stem, capture_output=True, text=True)
                    
                    if proc_stem.returncode == 0 and stem_path.exists() and stem_path.stat().st_size > 0:
                        stems[stem_name] = stem_path
                    else:
                        # 如果处理失败，回退到复制原始音频
                        logger.warning(f"Stem {stem_name} 处理失败，使用原始音频: {proc_stem.stderr}")
                        stem_path.write_bytes(base_wav.read_bytes())
                        stems[stem_name] = stem_path
            else:
                # 兜底：为每个 stem 生成不同频率的正弦波（避免 0 字节导致 416）
                import math
                
                stem_frequencies = {
                    "Vocals": 440.0,   # A4 音符
                    "Bass": 110.0,     # A2 音符（低音）
                    "Drums": 220.0,    # A3 音符（中音）
                    "Other": 330.0,   # E4 音符
                }
                
                for stem_name in stem_names:
                    stem_path = results_dir / f"{stem_name}.wav"
                    freq = stem_frequencies.get(stem_name, 440.0)
                    
                    with wave.open(str(stem_path), "wb") as wf:
                        wf.setnchannels(1)
                        wf.setsampwidth(2)  # 16-bit
                        wf.setframerate(44100)
                        
                        # 生成 1 秒不同频率的正弦波
                        frames = bytearray()
                        for i in range(44100):
                            v = int(12000 * math.sin(2 * math.pi * freq * (i / 44100.0)))
                            frames += int(v).to_bytes(2, byteorder="little", signed=True)
                        wf.writeframes(bytes(frames))
                    stems[stem_name] = stem_path

        return SeparationResult(
            stems=stems,
            sdr=8.5 if algorithm == Algorithm.DEMUCS_V4 else 6.2,
            sir=12.1 if algorithm == Algorithm.DEMUCS_V4 else 9.8,
            sar=7.8 if algorithm == Algorithm.DEMUCS_V4 else 7.1,
            comment=(
                "Excellent separation. Vocals remain crisp with minimal artifacting."
                if algorithm == Algorithm.DEMUCS_V4
                else "Moderate separation. Noticeable high-frequency loss in the accompaniment."
            ),
        )


class MSSLocalEngine(SeparationEngine):
    """
    基于 ZFTurbo 的 Music-Source-Separation-Training 仓库的本地分离引擎。

    设计目标：
    - 不在后端进程内直接 import torch 等重依赖，而是通过子进程调用 `inference.py`；
    - 每个任务将单个文件复制到临时 input_folder，输出写入 results_dir；
    - 仅依赖环境变量配置各模型权重路径，避免把 ckpt 文件路径写死在代码里。

    约定环境变量：
    - MSS_ROOT_DIR：Music-Source-Separation-Training-main 仓库根目录（可选，未设置则按项目相对路径推断）；
    - MSS_MDX23C_CKPT / MSS_DEMUCS4HT_CKPT / MSS_BS_ROFORMER_CKPT / MSS_SCNET_CKPT：
      对应算法的 ckpt 文件绝对路径；
    - MSS_MDX23C_CONFIG / ...：可选，若未设置则使用仓库 configs 目录下的默认配置。
    """

    # 与 app.models.Algorithm 中新增算法一一对应
    _MODEL_SPECS: Dict[Algorithm, _MSSModelSpec] = {
        Algorithm.MDX23C: _MSSModelSpec(
            model_type="mdx23c",
            default_config="config_musdb18_mdx23c.yaml",
            config_env="MSS_MDX23C_CONFIG",
            ckpt_env="MSS_MDX23C_CKPT",
        ),
        Algorithm.DEMUCS4HT: _MSSModelSpec(
            model_type="htdemucs",
            default_config="config_musdb18_htdemucs.yaml",
            config_env="MSS_DEMUCS4HT_CONFIG",
            ckpt_env="MSS_DEMUCS4HT_CKPT",
        ),
        Algorithm.BAND_SPLIT_ROFORMER: _MSSModelSpec(
            model_type="bs_roformer",
            default_config="config_musdb18_bs_roformer.yaml",
            config_env="MSS_BS_ROFORMER_CONFIG",
            ckpt_env="MSS_BS_ROFORMER_CKPT",
        ),
        Algorithm.SCNET: _MSSModelSpec(
            model_type="scnet",
            default_config="config_musdb18_scnet.yaml",
            config_env="MSS_SCNET_CONFIG",
            ckpt_env="MSS_SCNET_CKPT",
        ),
    }

    def __init__(self) -> None:
        # 推断 MSS 仓库根目录
        # 优先使用环境变量 MSS_ROOT_DIR，其次按项目结构推断：AudioLab/Music-Source-Separation-Training-main
        env_root = os.getenv("MSS_ROOT_DIR")
        if env_root:
            base = Path(env_root)
        else:
            # 当前文件：AudioLab/backend/app/services/separation_engine.py
            here = Path(__file__).resolve()
            # AudioLab 根目录
            project_root = here.parents[3] if len(here.parents) >= 4 else here.parents[-1]
            base = project_root / "Music-Source-Separation-Training-main"

        if not base.exists():
            raise RuntimeError(
                "未找到 Music-Source-Separation-Training-main 仓库目录。"
                "请设置环境变量 MSS_ROOT_DIR 指向该仓库根路径，"
                "或将其与 AudioLab 处于同一层级目录。"
            )

        self._mss_root = base
        self._inference_py = self._mss_root / "inference.py"
        if not self._inference_py.exists():
            raise RuntimeError(f"在 {self._mss_root} 下未找到 inference.py，路径可能不正确。")

        logger.info(f"MSSLocalEngine 初始化完成，MSS_ROOT_DIR={self._mss_root}")

    def _resolve_model_spec(self, algorithm: Algorithm) -> Tuple[_MSSModelSpec, Path, Path]:
        if algorithm not in self._MODEL_SPECS:
            raise ValueError(f"MSSLocalEngine 不支持的算法: {algorithm.value}")

        spec = self._MODEL_SPECS[algorithm]

        # 解析 config 路径（可被环境变量覆盖）
        cfg_override = os.getenv(spec.config_env)
        if cfg_override:
            config_path = Path(cfg_override)
        else:
            config_path = self._mss_root / "configs" / spec.default_config

        if not config_path.exists():
            raise RuntimeError(
                f"模型 {algorithm.value} 的 config 文件不存在：{config_path}。\n"
                f"如已放在其他位置，请设置环境变量 {spec.config_env} 为正确路径。"
            )

        # 权重 ckpt 必须通过环境变量提供
        ckpt_str = os.getenv(spec.ckpt_env)
        if not ckpt_str:
            raise RuntimeError(
                f"未设置 {spec.ckpt_env} 环境变量。\n"
                f"请先从 ZFTurbo 仓库下载 {spec.model_type} 的预训练权重，"
                f"然后将 {spec.ckpt_env} 设置为对应 .ckpt 文件的绝对路径。"
            )
        ckpt_path = Path(ckpt_str)
        if not ckpt_path.exists():
            raise RuntimeError(f"{spec.ckpt_env} 指向的权重文件不存在：{ckpt_path}")

        return spec, config_path, ckpt_path

    async def separate(
        self, *, input_path: Path, algorithm: Algorithm, results_dir: Path
    ) -> SeparationResult:
        """
        使用 MSS 仓库的 inference.py 对单个音频文件做分离。

        步骤：
        1. 将输入音频复制到临时 input_folder；
        2. 调用 `python inference.py ...` 输出到 results_dir；
        3. 扫描 results_dir 下生成的 `<file_name>/<instr>.wav`，
           统一整理为 Vocals/Drums/Bass/Other 等 stem 名。
        """
        results_dir.mkdir(parents=True, exist_ok=True)

        if not input_path.exists():
            raise FileNotFoundError(f"输入文件不存在: {input_path}")

        spec, config_path, ckpt_path = self._resolve_model_spec(algorithm)

        # 为 inference.py 准备临时输入目录
        with tempfile.TemporaryDirectory(prefix="audiolab_mss_in_") as in_dir_str:
            in_dir = Path(in_dir_str)
            tmp_input = in_dir / input_path.name
            shutil.copy2(input_path, tmp_input)

            # inference.py 会在 store_dir 下创建 {file_name}/{instr}.wav
            file_stem = input_path.stem

            cmd = [
                sys.executable,
                str(self._inference_py),
                "--model_type",
                spec.model_type,
                "--config_path",
                str(config_path),
                "--start_check_point",
                str(ckpt_path),
                "--input_folder",
                str(in_dir),
                "--store_dir",
                str(results_dir),
                "--disable_detailed_pbar",
            ]

            logger.info(
                "启动 MSS inference 子进程: %s",
                " ".join(cmd),
            )

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            stdout_text = stdout.decode(errors="ignore") if stdout else ""
            stderr_text = stderr.decode(errors="ignore") if stderr else ""

            if stdout_text:
                logger.debug("MSS inference stdout:\n%s", stdout_text)
            if stderr_text:
                logger.warning("MSS inference stderr:\n%s", stderr_text)

            if proc.returncode != 0:
                # 构建详细的错误消息
                error_msg = f"MSS inference 运行失败，exit code={proc.returncode}。"
                if stderr_text:
                    # 提取最后几行错误信息（通常最重要的错误在最后）
                    stderr_lines = stderr_text.strip().split('\n')
                    last_lines = stderr_lines[-5:] if len(stderr_lines) > 5 else stderr_lines
                    error_details = '\n'.join(last_lines)
                    error_msg += f"\n错误详情：\n{error_details}"
                elif stdout_text:
                    # 如果没有 stderr，尝试从 stdout 获取错误信息
                    stdout_lines = stdout_text.strip().split('\n')
                    last_lines = stdout_lines[-5:] if len(stdout_lines) > 5 else stdout_lines
                    error_details = '\n'.join(last_lines)
                    error_msg += f"\n输出信息：\n{error_details}"
                
                raise RuntimeError(error_msg)

        # 解析输出的 stems
        # 期望目录结构：results_dir/<file_stem>/<instr>.wav
        out_dir = results_dir / file_stem
        if not out_dir.exists():
            # 有些配置可能直接把文件放在 store_dir 下
            out_dir = results_dir

        stems: Dict[str, Path] = {}

        if not out_dir.exists():
            raise RuntimeError(
                f"在 {results_dir} 中未找到 MSS 输出结果，请检查 inference 设置。"
            )

        instrument_name_map = {
            "vocals": "Vocals",
            "drums": "Drums",
            "bass": "Bass",
            "other": "Other",
            "accompaniment": "Accompaniment",
            "instrumental": "Instrumental",
        }

        for p in out_dir.rglob("*"):
            if not p.is_file():
                continue
            if p.suffix.lower() not in {".wav", ".flac"}:
                continue

            raw_name = p.stem.lower()
            stem_name = instrument_name_map.get(raw_name, p.stem)

            # 为了简化前端处理，统一将最终文件放到 results_dir 顶层，例如 /app/results/{task_id}/Vocals.wav
            final_path = results_dir / f"{stem_name}.wav"

            if p.suffix.lower() == ".wav":
                if p.resolve() != final_path.resolve():
                    shutil.copy2(p, final_path)
            else:
                # 若为 FLAC 等格式，使用 ffmpeg 转码为 WAV
                cmd_convert = [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    str(p),
                    "-acodec",
                    "pcm_s16le",
                    str(final_path),
                ]
                conv_proc = subprocess.run(
                    cmd_convert, capture_output=True, text=True
                )
                if conv_proc.returncode != 0:
                    logger.error(
                        "转码 stem %s 为 WAV 失败: %s",
                        p,
                        conv_proc.stderr[:200],
                    )
                    continue

            if final_path.exists() and final_path.stat().st_size > 0:
                stems[stem_name] = final_path

        if not stems:
            raise RuntimeError(
                f"MSS inference 未生成任何有效的 stem 文件，请检查模型配置和输入音频。"
            )

        # 当前不从 MSS 返回客观指标，统一为 None，后续如需要可以从 valid.py 补充
        return SeparationResult(
            stems=stems,
            sdr=None,
            sir=None,
            sar=None,
            comment=f"MSS ({algorithm.value}) separation finished.",
        )


class HttpSeparationEngine(SeparationEngine):
    """
    预留：对接"独立服务器/远程模型服务"的 HTTP API。

    ========== 接口规范 ==========
    
    请求：
    - 方法: POST
    - URL: {MODEL_HTTP_URL} (从环境变量 MODEL_HTTP_URL 读取)
    - Content-Type: multipart/form-data
    - 参数:
      - file: 原始音频文件 (二进制)
      - algorithm: 算法名称字符串 (与后端 Algorithm.value 一致，如 "Demucs v4", "Spleeter" 等)
    
    响应：
    - Content-Type: application/json
    - 状态码: 200 (成功)
    - 响应体格式:
      {
        "stems_base64": {
          "Vocals": "<base64编码的WAV文件字节>",
          "Drums": "<base64编码的WAV文件字节>",
          "Bass": "<base64编码的WAV文件字节>",
          "Other": "<base64编码的WAV文件字节>"
        },
        "metrics": {
          "sdr": 8.1,        // 可选，Signal-Distortion Ratio (dB)
          "sir": 12.0,       // 可选，Signal-to-Interference Ratio (dB)
          "sar": 7.5,        // 可选，Signal-to-Artifacts Ratio (dB)
          "comment": "..."   // 可选，AI生成的文字总结
        }
      }
    
    错误处理：
    - 4xx/5xx 状态码会抛出 httpx.HTTPStatusError
    - 超时会抛出 httpx.TimeoutException
    - 网络错误会抛出 httpx.RequestError
    
    ========== 环境变量配置 ==========
    - SEPARATION_ENGINE=http
    - MODEL_HTTP_URL=http://your-model-service:9000/separate
    - MODEL_HTTP_TIMEOUT_S=300 (可选，默认300秒)
    """

    def __init__(self, *, url: str, timeout_s: float = 300.0):
        """
        初始化 HTTP 分离引擎
        
        Args:
            url: 模型服务的 HTTP API 地址
            timeout_s: 请求超时时间（秒），默认300秒
        """
        self._url = url
        self._timeout_s = timeout_s
        logger.info(f"HttpSeparationEngine 初始化: url={url}, timeout={timeout_s}s")

    async def separate(
        self, *, input_path: Path, algorithm: Algorithm, results_dir: Path
    ) -> SeparationResult:
        """
        调用远程 HTTP API 进行音频分离
        
        Args:
            input_path: 输入音频文件路径
            algorithm: 要使用的算法
            results_dir: 结果输出目录
            
        Returns:
            SeparationResult: 包含分离后的 stems 和可选的客观指标
            
        Raises:
            httpx.HTTPStatusError: HTTP 状态码错误
            httpx.TimeoutException: 请求超时
            httpx.RequestError: 网络请求错误
            ValueError: 响应格式错误或缺少必要字段
        """
        results_dir.mkdir(parents=True, exist_ok=True)
        
        if not input_path.exists():
            raise FileNotFoundError(f"输入文件不存在: {input_path}")
        
        file_size = input_path.stat().st_size
        logger.info(
            f"开始调用 HTTP 分离服务: url={self._url}, "
            f"algorithm={algorithm.value}, file={input_path.name}, size={file_size} bytes"
        )

        try:
            async with httpx.AsyncClient(timeout=self._timeout_s) as client:
                with open(input_path, "rb") as f:
                    files = {"file": (input_path.name, f, "application/octet-stream")}
                    data = {"algorithm": str(algorithm.value)}
                    
                    logger.debug(f"发送请求到 {self._url}, algorithm={algorithm.value}")
                    resp = await client.post(self._url, files=files, data=data)

                resp.raise_for_status()
                payload = resp.json()
                
                logger.debug(f"收到响应: status={resp.status_code}, payload_keys={list(payload.keys())}")

        except httpx.TimeoutException as e:
            logger.error(f"HTTP 请求超时: {self._url}, timeout={self._timeout_s}s")
            raise RuntimeError(f"模型服务请求超时（{self._timeout_s}秒）") from e
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP 状态错误: {e.response.status_code}, {e.response.text[:200]}")
            raise RuntimeError(
                f"模型服务返回错误: {e.response.status_code} - {e.response.text[:200]}"
            ) from e
        except httpx.RequestError as e:
            logger.error(f"HTTP 请求失败: {type(e).__name__}, {str(e)}")
            raise RuntimeError(f"无法连接到模型服务: {str(e)}") from e
        except Exception as e:
            logger.error(f"调用模型服务时发生未知错误: {type(e).__name__}, {str(e)}")
            raise

        # 验证响应格式
        stems_b64 = payload.get("stems_base64")
        if not isinstance(stems_b64, dict) or not stems_b64:
            error_msg = "HTTP 模型服务返回缺少或格式错误的 stems_base64 字段"
            logger.error(f"{error_msg}, payload_keys={list(payload.keys())}")
            raise ValueError(error_msg)

        # 解码并保存 stems
        stems: Dict[str, Path] = {}
        expected_stems = ["Vocals", "Drums", "Bass", "Other"]
        
        for stem_name, b64 in stems_b64.items():
            if not isinstance(stem_name, str) or not isinstance(b64, str):
                logger.warning(f"跳过无效的 stem 条目: stem_name={stem_name}, type={type(b64)}")
                continue
            
            try:
                raw = base64.b64decode(b64)
                if len(raw) == 0:
                    logger.warning(f"Stem {stem_name} 的 base64 解码后为空")
                    continue
                    
                out_path = results_dir / f"{stem_name}.wav"
                out_path.write_bytes(raw)
                stems[stem_name] = out_path
                logger.debug(f"已保存 stem: {stem_name}, size={len(raw)} bytes")
                
            except Exception as e:
                logger.error(f"解码/保存 stem {stem_name} 时出错: {type(e).__name__}, {str(e)}")
                # 继续处理其他 stems，不因单个失败而中断

        if not stems:
            raise ValueError("所有 stems 解码/保存失败，无法继续")

        # 提取客观指标（可选）
        metrics = payload.get("metrics") or {}
        sdr = metrics.get("sdr")
        sir = metrics.get("sir")
        sar = metrics.get("sar")
        comment = metrics.get("comment")
        
        # 验证指标类型
        if sdr is not None and not isinstance(sdr, (int, float)):
            logger.warning(f"SDR 类型错误，忽略: {type(sdr)}")
            sdr = None
        if sir is not None and not isinstance(sir, (int, float)):
            logger.warning(f"SIR 类型错误，忽略: {type(sir)}")
            sir = None
        if sar is not None and not isinstance(sar, (int, float)):
            logger.warning(f"SAR 类型错误，忽略: {type(sar)}")
            sar = None
        if comment is not None and not isinstance(comment, str):
            logger.warning(f"Comment 类型错误，忽略: {type(comment)}")
            comment = None

        logger.info(
            f"HTTP 分离完成: stems={list(stems.keys())}, "
            f"metrics={{sdr={sdr}, sir={sir}, sar={sar}}}"
        )

        return SeparationResult(
            stems=stems,
            sdr=float(sdr) if sdr is not None else None,
            sir=float(sir) if sir is not None else None,
            sar=float(sar) if sar is not None else None,
            comment=comment,
        )


class LocalSeparationEngine(SeparationEngine):
    """
    预留：对接“本地模型/本机推理”。
    这里不直接实现具体算法，避免把 Demucs/Spleeter 等依赖硬塞进仓库；
    你只需要把 MODEL_LOCAL_CMD 指向一个可执行脚本即可。

    约定：
    - 你提供的脚本负责把 stems 写入 results_dir，文件名用 Vocals.wav/Drums.wav/... 这种。
    """

    def __init__(self, *, command: str):
        self._command = command

    async def separate(
        self, *, input_path: Path, algorithm: Algorithm, results_dir: Path
    ) -> SeparationResult:
        """
        保持向后兼容：如果你已经有现成的本地脚本（例如调用 ByteDance 的 music_source_separation），
        可以把 MODEL_LOCAL_CMD 指向该脚本，这里通过子进程调用。

        要求：
        - 脚本接收 3 个位置参数：<input_path> <results_dir> <algorithm_name>
        - 脚本负责在 results_dir 下生成 Vocals.wav / Drums.wav / Bass.wav / Other.wav 等文件。
        """
        results_dir.mkdir(parents=True, exist_ok=True)

        if not input_path.exists():
            raise FileNotFoundError(f"输入文件不存在: {input_path}")

        cmd = f"{self._command} {input_path} {results_dir} {algorithm.name}"
        logger.info("调用本地分离脚本: %s", cmd)

        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if stdout:
            logger.debug("LocalSeparationEngine stdout:\n%s", stdout.decode(errors="ignore"))
        if stderr:
            logger.warning("LocalSeparationEngine stderr:\n%s", stderr.decode(errors="ignore"))

        if proc.returncode != 0:
            raise RuntimeError(f"本地分离脚本执行失败，exit code={proc.returncode}")

        stems: Dict[str, Path] = {}
        for name in ["Vocals", "Drums", "Bass", "Other"]:
            p = results_dir / f"{name}.wav"
            if p.exists() and p.stat().st_size > 0:
                stems[name] = p

        if not stems:
            raise RuntimeError("本地脚本未在结果目录中生成任何有效 stem 文件。")

        return SeparationResult(stems=stems)


def build_separation_engine_from_env() -> SeparationEngine:
    """
    根据环境变量构建分离引擎：
    - SEPARATION_ENGINE=mock  ：使用 MockSeparationEngine（默认，用于前端联调和演示）；
    - SEPARATION_ENGINE=http  ：调用远程 HTTP 模型服务（云端/独立 GPU 服务器）；
    - SEPARATION_ENGINE=local ：调用你自定义的本地脚本（例如 ByteDance 仓库封装脚本）；
    - SEPARATION_ENGINE=mss   ：直接调用 ZFTurbo 的 Music-Source-Separation-Training 仓库进行本地推理。
    """
    mode = (os.getenv("SEPARATION_ENGINE") or "mock").strip().lower()

    if mode == "http":
        url = os.getenv("MODEL_HTTP_URL")
        if not url:
            raise ValueError("SEPARATION_ENGINE=http 时必须设置 MODEL_HTTP_URL")
        timeout_s = float(os.getenv("MODEL_HTTP_TIMEOUT_S") or "300")
        return HttpSeparationEngine(url=url, timeout_s=timeout_s)

    if mode == "local":
        cmd = os.getenv("MODEL_LOCAL_CMD")
        if not cmd:
            raise ValueError("SEPARATION_ENGINE=local 时必须设置 MODEL_LOCAL_CMD")
        return LocalSeparationEngine(command=cmd)

    if mode == "mss":
        return MSSLocalEngine()

    # 默认 mock
    return MockSeparationEngine()

