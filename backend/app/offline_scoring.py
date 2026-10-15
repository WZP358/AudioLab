"""
离线评分工具：把盲化样本导出为「编号音频包 + Excel 评分表」，导师离线评分后导回数据库。

背景：导师在实验室听不清、远程又没声音，无法在线评分。因此：
  1. export —— 按声源（默认 Drums）导出全部盲化样本，音频按号码编号打包成 zip，并生成 Excel 评分表；
  2. import —— 导师填完 Excel 后，读回评分并写入 scores 表（记到指定用户名下）。

用法（在 backend 目录）：
  .venv/bin/python -m app.offline_scoring export --stem Drums
  .venv/bin/python -m app.offline_scoring import --file <返回的评分表.xlsx> --username yusha

设计要点：
- 编号顺序固定为 task_id、start_seconds 升序，导出时同时写入 mapping.json，导入时优先用
  Excel 里的「内部编号」(blind_code) 回查，抗乱序/重排。
- 评分维度与盲化评分一致：quality/interference/artifacts/overall_acceptability/reliability（1-5）。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select, text

from app.database import AsyncSessionLocal, engine
from app.models import BlindSample, Score, Role, User

# 导出根目录：results/offline_scoring/<stem小写>/
_EXPORT_ROOT = Path(__file__).resolve().parents[2] / "results" / "offline_scoring"

# 评分维度（与 Score 模型 / BlindScoreCreate 一致）
_SCORE_DIMS = [
    ("quality", "音质(1-5)"),
    ("interference", "干扰(1-5)"),
    ("artifacts", "伪影(1-5)"),
    ("overall_acceptability", "整体可接受度(1-5)"),
    ("reliability", "可靠性(1-5)"),
]

# 填写说明正文（写到 Excel 的「填写说明」sheet）
_FILL_INSTRUCTIONS = [
    ("音质", "该 15 秒鼓声片段的整体音质。1=非常差，5=非常好。"),
    ("干扰", "其它声源（人声/贝斯/其它）串入鼓声的程度。1=串扰非常严重，5=几乎无串扰。"),
    ("伪影", "分离产生的可闻伪影（如金属音、水声、断续）。1=伪影非常严重，5=几乎无伪影。"),
    ("整体可接受度", "综合听感是否可接受。1=完全不可接受，5=完全可接受。"),
    ("可靠性", "您对自己本次判断的把握程度。1=很不确定，5=非常确定。"),
    ("问题标签", "可选。从「问题标签参考」表里选择最贴切的问题（可多选，用 、 或 , 分隔）。"),
]


def _stem_dir(stem_name: str) -> Path:
    return _EXPORT_ROOT / stem_name.strip().lower()


async def _load_drum_samples(db, stem_name: str) -> list[BlindSample]:
    result = await db.execute(
        select(BlindSample)
        .where(BlindSample.stem_name == stem_name)
        .order_by(BlindSample.task_id.asc(), BlindSample.start_seconds.asc())
    )
    return list(result.scalars().all())


def _assign_song_letters(samples: list[BlindSample]) -> list[str]:
    """按 task_id 出现顺序把样本分到曲目 A/B/C…（同一 task 即同一首混合音频）。"""
    seen: dict[int, str] = {}
    letters: list[str] = []
    for s in samples:
        if s.task_id not in seen:
            seen[s.task_id] = chr(ord("A") + len(seen))
        letters.append(seen[s.task_id])
    return letters


async def _load_standard_labels(db, stem_name: str) -> list[tuple[str, str]]:
    result = await db.execute(
        text(
            "SELECT label, description FROM standard_labels "
            "WHERE stem_name = :stem AND is_active = 1 ORDER BY label"
        ),
        {"stem": stem_name},
    )
    return [(row[0], row[1] or "") for row in result]


async def export_blind_samples(stem_name: str = "Drums") -> dict:
    """导出指定声源的盲化样本：编号音频 + Excel 评分表 + zip + mapping.json。"""
    out_dir = _stem_dir(stem_name)
    audio_dir = out_dir / "音频"
    audio_dir.mkdir(parents=True, exist_ok=True)

    async with AsyncSessionLocal() as db:
        samples = await _load_drum_samples(db, stem_name)
        if not samples:
            raise SystemExit(f"没有找到 stem_name={stem_name} 的盲化样本")
        letters = _assign_song_letters(samples)
        labels = await _load_standard_labels(db, stem_name)

    # 复制音频并建立编号映射
    mapping = []
    for idx, (sample, letter) in enumerate(zip(samples, letters), start=1):
        filename = f"{idx:02d}.wav"
        src = Path(sample.file_path)
        if not src.exists():
            raise SystemExit(f"音频文件不存在：{src}")
        shutil.copy2(src, audio_dir / filename)
        mapping.append(
            {
                "no": idx,
                "song": letter,
                "filename": filename,
                "blind_code": sample.blind_code,
                "sample_id": str(sample.id),
                "task_id": str(sample.task_id),
                "algorithm": sample.algorithm.value,
                "stem_name": sample.stem_name,
                "segment_start": sample.start_seconds,
                "segment_end": sample.end_seconds,
            }
        )

    # 写 mapping.json（导入时兜底用）
    mapping_path = out_dir / "mapping.json"
    mapping_path.write_text(
        json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 生成 Excel 评分表
    xlsx_path = out_dir / f"{stem_name}评分表.xlsx"
    xlsx_path.write_bytes(_build_score_xlsx(mapping, labels, stem_name))

    # 打包 zip（音频 + 评分表）
    zip_path = out_dir / f"{stem_name}评分包.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for m in mapping:
            zf.write(audio_dir / m["filename"], arcname=f"音频/{m['filename']}")
        zf.write(xlsx_path, arcname=xlsx_path.name)

    return {
        "stem_name": stem_name,
        "count": len(mapping),
        "out_dir": str(out_dir),
        "zip": str(zip_path),
        "xlsx": str(xlsx_path),
        "mapping": str(mapping_path),
    }


def _build_score_xlsx(mapping: list[dict], labels: list[tuple[str, str]], stem_name: str) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.datavalidation import DataValidation

    wb = Workbook()

    # —— Sheet 1：评分表 ——
    ws = wb.active
    ws.title = "评分表"
    headers = ["编号", "曲目", "音频文件"] + [h for _, h in _SCORE_DIMS] + ["问题标签(可多选)", "内部编号(勿改)"]
    ws.append(headers)
    header_fill = PatternFill("solid", fgColor="0891B2")
    header_font = Font(bold=True, color="FFFFFF")
    for cell in ws[1]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for m in mapping:
        ws.append(
            [
                m["no"],
                m["song"],
                m["filename"],
                None,  # quality
                None,  # interference
                None,  # artifacts
                None,  # overall_acceptability
                None,  # reliability
                "",
                m["blind_code"],
            ]
        )
    ws.freeze_panes = "A2"

    # 5 个评分列加 1-5 下拉校验
    dv = DataValidation(type="whole", operator="between", formula1="1", formula2="5", allow_blank=True)
    dv.error = "请输入 1-5 之间的整数"
    dv.errorTitle = "评分超出范围"
    dv.prompt = "请输入 1-5"
    dv.promptTitle = "评分"
    ws.add_data_validation(dv)
    first_score_col = 4  # D 列
    last_score_col = first_score_col + len(_SCORE_DIMS) - 1
    for col in range(first_score_col, last_score_col + 1):
        letter = get_column_letter(col)
        dv.add(f"{letter}2:{letter}{len(mapping) + 1}")

    # 列宽
    widths = {"A": 6, "B": 6, "C": 12, "D": 10, "E": 10, "F": 10, "G": 16, "H": 10, "I": 30, "J": 26}
    for letter, w in widths.items():
        ws.column_dimensions[letter].width = w

    # —— Sheet 2：填写说明 ——
    ws2 = wb.create_sheet("填写说明")
    ws2.append(["维度", "说明"])
    ws2.cell(1, 1).font = header_font
    ws2.cell(1, 1).fill = header_fill
    ws2.cell(1, 2).font = header_font
    ws2.cell(1, 2).fill = header_fill
    for dim, desc in _FILL_INSTRUCTIONS:
        ws2.append([dim, desc])
    ws2.column_dimensions["A"].width = 16
    ws2.column_dimensions["B"].width = 60

    # —— Sheet 3：问题标签参考 ——
    ws3 = wb.create_sheet("问题标签参考")
    ws3.append(["问题标签", "说明"])
    ws3.cell(1, 1).font = header_font
    ws3.cell(1, 1).fill = header_fill
    ws3.cell(1, 2).font = header_font
    ws3.cell(1, 2).fill = header_fill
    for label, desc in labels:
        ws3.append([label, desc])
    ws3.column_dimensions["A"].width = 20
    ws3.column_dimensions["B"].width = 40

    import io

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _parse_tags(raw: str) -> list[str]:
    """把问题标签列解析为去重后的标签列表，支持 、 ， , ; ； 换行分隔。"""
    if not raw:
        return []
    for sep in ("、", "，", ",", ";", "；", "\n"):
        raw = raw.replace(sep, "|")
    cleaned: list[str] = []
    for item in raw.split("|"):
        label = item.strip()
        if label and label not in cleaned and len(label) <= 100:
            cleaned.append(label)
    return cleaned[:20]


async def _find_user(db, username: str) -> User:
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalars().first()
    if not user:
        raise SystemExit(f"用户不存在：{username}")
    return user


async def import_scores(file_path: str, username: str = "yusha") -> dict:
    """读回导师填好的评分表，写入 scores 表（记到指定用户名下）。"""
    from openpyxl import load_workbook

    path = Path(file_path)
    if not path.exists():
        raise SystemExit(f"文件不存在：{path}")

    wb = load_workbook(path, data_only=True)
    ws = wb["评分表"] if "评分表" in wb.sheetnames else wb.active

    async with AsyncSessionLocal() as db:
        user = await _find_user(db, username)

        # 读表头，定位「内部编号」「编号」列，避免硬编码列位置
        header_row = None
        for row in ws.iter_rows(min_row=1, max_row=5):
            values = [c.value for c in row]
            if any(v == "内部编号(勿改)" for v in values):
                header_row = values
                break
        if header_row is None:
            raise SystemExit("评分表缺少「内部编号(勿改)」列，无法回查样本")

        col_code = header_row.index("内部编号(勿改)") + 1
        dim_cols = {}
        for dim, title in _SCORE_DIMS:
            if title in header_row:
                dim_cols[dim] = header_row.index(title) + 1
        col_tags = header_row.index("问题标签(可多选)") + 1 if "问题标签(可多选)" in header_row else None

        # 预载全部盲化样本，按 blind_code 建立索引
        samples_result = await db.execute(select(BlindSample))
        samples_by_code = {s.blind_code: s for s in samples_result.scalars().all()}

        # 已评分样本（避免重复导入）
        scored_result = await db.execute(
            select(Score.blind_sample_id).where(
                Score.user_id == str(user.id), Score.blind_sample_id.isnot(None)
            )
        )
        already_scored = {row[0] for row in scored_result.all()}

        imported = 0
        skipped_empty = 0
        skipped_duplicate = 0
        errors: list[str] = []

        for row in ws.iter_rows(min_row=2):
            values = [c.value for c in row]
            blind_code = values[col_code - 1] if col_code else None
            if blind_code is None or str(blind_code).strip() == "":
                # 空行或缺少内部编号：若整行评分均为空则跳过，否则报错
                any_score = any(values[dc - 1] not in (None, "") for dc in dim_cols.values())
                if any_score:
                    errors.append(f"第 {row[0].row} 行缺少内部编号，无法导入")
                else:
                    skipped_empty += 1
                continue
            blind_code = str(blind_code).strip()
            sample = samples_by_code.get(blind_code)
            if not sample:
                errors.append(f"内部编号 {blind_code} 找不到对应样本")
                continue

            # 解析评分
            score_vals: dict[str, int] = {}
            missing = []
            for dim, dc in dim_cols.items():
                raw = values[dc - 1] if dc else None
                if raw is None or raw == "":
                    missing.append(dim)
                    continue
                try:
                    iv = int(raw)
                except (TypeError, ValueError):
                    errors.append(f"样本 {blind_code} 的 {dim} 不是整数：{raw!r}")
                    break
                if not (1 <= iv <= 5):
                    errors.append(f"样本 {blind_code} 的 {dim} 超出 1-5：{iv}")
                    break
                score_vals[dim] = iv
            else:
                if missing:
                    if len(missing) == len(dim_cols):
                        # 评分全空：该样本尚未评分，跳过（导师可能分批填写）
                        skipped_empty += 1
                    else:
                        # 部分填写：数据不完整，报错
                        errors.append(f"样本 {blind_code} 缺少评分维度：{', '.join(missing)}")
                    continue
                if sample.id in already_scored:
                    skipped_duplicate += 1
                    continue

                tags = _parse_tags(str(values[col_tags - 1] or "")) if col_tags else []
                db.add(
                    Score(
                        user_id=str(user.id),
                        task_id=sample.task_id,
                        blind_sample_id=sample.id,
                        algorithm=sample.algorithm,
                        stem_name=sample.stem_name,
                        quality=score_vals["quality"],
                        interference=score_vals["interference"],
                        artifacts=score_vals["artifacts"],
                        overall_acceptability=score_vals["overall_acceptability"],
                        segment_start=sample.start_seconds,
                        segment_end=sample.end_seconds,
                        issue_tags=json.dumps(tags, ensure_ascii=False),
                        issue_annotations=json.dumps([], ensure_ascii=False),
                        reliability=score_vals["reliability"],
                    )
                )
                imported += 1

        if errors:
            # 有错误时整体回滚，避免部分写入
            await db.rollback()
            print("导入失败，已回滚（未写入任何记录）：")
            for e in errors:
                print(f"  - {e}")
            return {
                "imported": 0,
                "skipped_empty": skipped_empty,
                "skipped_duplicate": skipped_duplicate,
                "errors": errors,
            }

        await db.commit()
        print(
            f"导入完成：新增 {imported} 条评分，跳过空行 {skipped_empty} 行、"
            f"已评分 {skipped_duplicate} 条，归属用户 {username}。"
        )
        return {
            "imported": imported,
            "skipped_empty": skipped_empty,
            "skipped_duplicate": skipped_duplicate,
            "errors": errors,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="离线评分导出/导入工具")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_export = sub.add_parser("export", help="导出编号音频包 + Excel 评分表")
    p_export.add_argument("--stem", default="Drums", help="声源名（Vocals/Drums/Bass/Other）")

    p_import = sub.add_parser("import", help="读回评分表并写入数据库")
    p_import.add_argument("--file", required=True, help="导师返回的评分表 .xlsx 路径")
    p_import.add_argument("--username", default="yusha", help="评分归属的用户名")

    args = parser.parse_args()
    if args.cmd == "export":
        asyncio.run(_run_export(args.stem))
    else:
        asyncio.run(_run_import(args.file, args.username))


async def _run_import(file_path: str, username: str) -> None:
    try:
        await import_scores(file_path, username)
    finally:
        await engine.dispose()


async def _run_export(stem_name: str) -> None:
    try:
        info = await export_blind_samples(stem_name)
    finally:
        await engine.dispose()
    print(json.dumps(info, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
