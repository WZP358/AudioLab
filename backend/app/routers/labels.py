from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import StandardLabel, User
from app.routers.admin import get_current_admin
from app.routers.auth import get_current_user


router = APIRouter(prefix="/api/standard-labels", tags=["standard-labels"])
VALID_STEMS = {"Vocals", "Drums", "Bass", "Other"}


class LabelPayload(BaseModel):
    stem_name: str
    label: str
    description: Optional[str] = None
    is_active: bool = True

    @field_validator("stem_name")
    @classmethod
    def validate_stem(cls, value: str) -> str:
        if value not in VALID_STEMS:
            raise ValueError("声源必须是 Vocals、Drums、Bass 或 Other")
        return value

    @field_validator("label")
    @classmethod
    def validate_label(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 100:
            raise ValueError("标签名称长度应为 1-100 个字符")
        return value


def serialize_label(item: StandardLabel) -> dict:
    return {
        "id": str(item.id),
        "stem_name": item.stem_name,
        "label": item.label,
        "description": item.description,
        "is_active": item.is_active,
    }


@router.get("")
async def list_labels(
    stem_name: Optional[str] = None,
    include_inactive: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(StandardLabel)
    if stem_name:
        query = query.where(StandardLabel.stem_name == stem_name)
    if not include_inactive:
        query = query.where(StandardLabel.is_active.is_(True))
    result = await db.execute(query.order_by(StandardLabel.stem_name, StandardLabel.label))
    return [serialize_label(item) for item in result.scalars().all()]


@router.post("")
async def create_label(
    payload: LabelPayload,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(select(StandardLabel).where(StandardLabel.stem_name == payload.stem_name, StandardLabel.label == payload.label))
    if existing.scalars().first():
        raise HTTPException(status_code=409, detail="该声源下已存在同名标签")
    item = StandardLabel(**payload.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return serialize_label(item)


@router.post("/ensure")
async def ensure_label(
    payload: LabelPayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """专家自定义听感问题标签：若该声源下不存在同名标签则自动创建，幂等返回已有或新建的标签。"""
    existing = await db.execute(
        select(StandardLabel).where(
            StandardLabel.stem_name == payload.stem_name,
            StandardLabel.label == payload.label,
        )
    )
    item = existing.scalars().first()
    if item:
        return serialize_label(item)
    item = StandardLabel(**payload.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return serialize_label(item)


@router.put("/{label_id}")
async def update_label(
    label_id: int,
    payload: LabelPayload,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(StandardLabel, label_id)
    if not item:
        raise HTTPException(status_code=404, detail="标签不存在")
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return serialize_label(item)


@router.delete("/{label_id}")
async def delete_label(
    label_id: int,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(StandardLabel, label_id)
    if not item:
        raise HTTPException(status_code=404, detail="标签不存在")
    await db.delete(item)
    await db.commit()
    return {"message": "标签已删除"}
