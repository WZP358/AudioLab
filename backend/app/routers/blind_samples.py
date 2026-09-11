import json
import secrets
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import BlindSample, Role, Score, SeparationTask, StemFile, TaskStatus, User
from app.routers.admin import get_current_admin
from app.routers.auth import get_current_user
from app.schemas import BlindScoreCreate


router = APIRouter(prefix="/api/blind-samples", tags=["blind-samples"])
# 固定到仓库根目录，避免 uvicorn 从不同 cwd 启动时生成/读取路径不一致。
BLIND_DIR = Path(__file__).resolve().parents[3] / "results" / "blind_samples"


class GenerateBlindSamples(BaseModel):
    task_id: int
    stem_names: list[str] = Field(default_factory=lambda: ["Vocals", "Drums", "Bass", "Other"])
    include_partial_tail: bool = False


def _duration_seconds(path: Path) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "无法读取音频时长")
    return float(proc.stdout.strip())


def _write_15_second_clip(source: Path, output: Path, start_seconds: float) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-ss", f"{start_seconds:.3f}", "-i", str(source),
            "-af", "apad", "-t", "15", "-ar", "44100", "-ac", "2",
            "-c:a", "pcm_s16le", str(output),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if proc.returncode != 0 or not output.exists() or output.stat().st_size == 0:
        raise RuntimeError(proc.stderr.strip() or "15 秒样本生成失败")
    actual = _duration_seconds(output)
    if abs(actual - 15.0) > 0.05:
        output.unlink(missing_ok=True)
        raise RuntimeError(f"生成样本时长异常：{actual:.3f} 秒")


@router.post("/generate")
async def generate_blind_samples(
    payload: GenerateBlindSamples,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(SeparationTask, payload.task_id)
    if not task or task.status != TaskStatus.COMPLETED:
        raise HTTPException(status_code=409, detail="只能为已完成的真实分离任务生成盲化样本")
    result = await db.execute(select(StemFile).where(StemFile.task_id == task.id))
    stems = [item for item in result.scalars().all() if item.stem_name in set(payload.stem_names)]
    if not stems:
        raise HTTPException(status_code=404, detail="任务中没有可生成的声源文件")

    created = []
    generated_paths = []
    try:
        for stem in stems:
            source = Path(stem.file_path)
            if not source.exists() or source.stat().st_size == 0:
                raise HTTPException(status_code=409, detail=f"{stem.stem_name} 声源文件不存在或为空")
            duration = _duration_seconds(source)
            starts = [float(v) for v in range(0, int(duration), 15) if v + 15 <= duration + 0.01]
            if not starts and payload.include_partial_tail and duration > 0:
                starts = [0.0]
            elif payload.include_partial_tail and duration % 15 > 0.05:
                starts.append(float(int(duration // 15) * 15))
            for start in starts[:100]:
                existing = await db.execute(select(BlindSample).where(BlindSample.task_id == task.id, BlindSample.stem_name == stem.stem_name, BlindSample.start_seconds == start))
                sample = existing.scalars().first()
                if not sample:
                    code = secrets.token_urlsafe(18)
                    output = BLIND_DIR / f"{code}.wav"
                    _write_15_second_clip(source, output, start)
                    generated_paths.append(output)
                    sample = BlindSample(
                        blind_code=code,
                        task_id=task.id,
                        algorithm=task.algorithm,
                        stem_name=stem.stem_name,
                        start_seconds=start,
                        end_seconds=start + 15.0,
                        file_path=str(output),
                    )
                    db.add(sample)
                    await db.flush()
                created.append({"blind_code": sample.blind_code, "stem_name": sample.stem_name, "duration_seconds": 15.0})
        await db.commit()
    except HTTPException:
        await db.rollback()
        for path in generated_paths:
            path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        await db.rollback()
        for path in generated_paths:
            path.unlink(missing_ok=True)
        raise HTTPException(status_code=503, detail=f"盲化样本生成失败：{exc}") from exc
    return {"created_or_existing": len(created), "samples": created}


@router.get("")
async def list_blind_samples(
    stem_name: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(BlindSample)
    if stem_name:
        query = query.where(BlindSample.stem_name == stem_name)
    result = await db.execute(query.order_by(BlindSample.created_at.desc()))
    samples = list(result.scalars().all())
    score_result = await db.execute(select(Score.blind_sample_id).where(Score.user_id == str(current_user.id), Score.blind_sample_id.isnot(None)))
    scored = {row[0] for row in score_result.all()}
    # 专家响应有意不包含 task_id、algorithm、真实文件名或原始时间位置。
    return [
        {
            "blind_code": item.blind_code,
            "stem_name": item.stem_name,
            "duration_seconds": 15.0,
            "audio_url": f"/api/blind-samples/{item.blind_code}/audio",
            "scored": item.id in scored,
        }
        for item in samples
    ]


@router.get("/{blind_code}/audio")
async def stream_blind_sample(
    blind_code: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in (Role.EXPERT, Role.ADMIN):
        raise HTTPException(status_code=403, detail="仅专家或管理员可试听盲化样本")
    result = await db.execute(select(BlindSample).where(BlindSample.blind_code == blind_code))
    sample = result.scalars().first()
    if not sample:
        raise HTTPException(status_code=404, detail="盲化样本不存在")
    path = Path(sample.file_path)
    if not path.exists() or path.stat().st_size == 0:
        raise HTTPException(status_code=404, detail="盲化样本文件不存在")
    return FileResponse(path, media_type="audio/wav", filename="blind-sample.wav", headers={"Accept-Ranges": "bytes", "Cache-Control": "no-store"})


@router.post("/score")
async def score_blind_sample(
    payload: BlindScoreCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != Role.EXPERT:
        raise HTTPException(status_code=403, detail="仅专家可提交盲化评分")
    result = await db.execute(select(BlindSample).where(BlindSample.blind_code == payload.blind_code))
    sample = result.scalars().first()
    if not sample:
        raise HTTPException(status_code=404, detail="盲化样本不存在")
    duplicate = await db.execute(select(Score).where(Score.user_id == str(current_user.id), Score.blind_sample_id == sample.id))
    if duplicate.scalars().first():
        raise HTTPException(status_code=409, detail="该盲化样本已经评分")
    score = Score(
        user_id=str(current_user.id),
        task_id=sample.task_id,
        blind_sample_id=sample.id,
        algorithm=sample.algorithm,
        stem_name=sample.stem_name,
        quality=payload.quality,
        interference=payload.interference,
        artifacts=payload.artifacts,
        overall_acceptability=payload.overall_acceptability,
        segment_start=payload.segment_start,
        segment_end=payload.segment_end,
        issue_tags=json.dumps(payload.issue_tags, ensure_ascii=False),
        reliability=payload.reliability,
    )
    db.add(score)
    await db.commit()
    await db.refresh(score)
    # 专家侧只需要确认保存成功；绝不回传 task/algorithm 等映射字段。
    return {"id": str(score.id), "blind_code": sample.blind_code, "status": "saved"}


@router.get("/admin/mapping")
async def get_blind_mapping(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(BlindSample).order_by(BlindSample.created_at.desc()))
    return [
        {
            "blind_code": item.blind_code,
            "task_id": str(item.task_id),
            "algorithm": item.algorithm.value,
            "stem_name": item.stem_name,
            "source_start_seconds": item.start_seconds,
            "source_end_seconds": item.end_seconds,
        }
        for item in result.scalars().all()
    ]
