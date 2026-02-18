from pydantic import BaseModel, EmailStr, field_serializer
from typing import Optional, List
from datetime import datetime
from app.models import TaskStatus, Algorithm, Role


class TaskCreate(BaseModel):
    algorithm: Algorithm


class TaskResponse(BaseModel):
    id: int  # 保持为 int，在序列化时转为字符串
    user_id: str
    original_filename: str
    algorithm: Algorithm
    status: TaskStatus
    created_at: datetime
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    sdr: Optional[float] = None
    sir: Optional[float] = None
    sar: Optional[float] = None
    comment: Optional[str] = None

    class Config:
        from_attributes = True

    @field_serializer('id')
    def serialize_id(self, value: int, _info) -> str:
        """将 ID 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)


class StemResponse(BaseModel):
    id: int  # 保持为 int，在序列化时转为字符串
    task_id: int  # 保持为 int，在序列化时转为字符串
    stem_name: str
    file_path: str
    created_at: datetime

    class Config:
        from_attributes = True

    @field_serializer('id')
    def serialize_id(self, value: int, _info) -> str:
        """将 ID 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)

    @field_serializer('task_id')
    def serialize_task_id(self, value: int, _info) -> str:
        """将 task_id 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)


class AudioAnalysisPayload(BaseModel):
    sample_rate: int
    duration_s: float
    waveform: List[float]
    spectrogram: List[List[float]]
    bit_depth: Optional[int] = None


class TaskAnalysisResponse(BaseModel):
    task_id: int  # 保持为 int，在序列化时转为字符串
    target_stem: Optional[str] = None
    original: Optional[AudioAnalysisPayload] = None
    target: Optional[AudioAnalysisPayload] = None
    stems: Optional[dict[str, Optional[AudioAnalysisPayload]]] = None

    @field_serializer('task_id')
    def serialize_task_id(self, value: int, _info) -> str:
        """将 task_id 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)


class ObjectiveMetricsResponse(BaseModel):
    target_stem: str
    sdr: float
    sir: float
    sar: float
    comment: Optional[str] = None


class ScoreCreate(BaseModel):
    task_id: int
    algorithm: Algorithm
    stem_name: str
    quality: int
    interference: int
    artifacts: int


class ScoreResponse(BaseModel):
    id: int  # 保持为 int，在序列化时转为字符串
    user_id: str
    task_id: int  # 保持为 int，在序列化时转为字符串
    algorithm: Algorithm
    stem_name: str | None = None
    quality: int
    interference: int
    artifacts: int
    created_at: datetime

    class Config:
        from_attributes = True

    @field_serializer('id')
    def serialize_id(self, value: int, _info) -> str:
        """将 ID 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)

    @field_serializer('task_id')
    def serialize_task_id(self, value: int, _info) -> str:
        """将 task_id 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)


class StatsResponse(BaseModel):
    algorithm: Algorithm
    stem_name: str | None = None
    avg_quality: float
    avg_interference: float
    avg_artifacts: float
    total_scores: int


class DetailedStatsResponse(BaseModel):
    algorithm: Algorithm
    stem_name: str | None = None
    avg_quality: float
    avg_interference: float
    avg_artifacts: float
    total_scores: int
    unique_experts: int


class AlgorithmComparisonResponse(BaseModel):
    algorithm: Algorithm
    overall_avg_quality: float
    overall_avg_interference: float
    overall_avg_artifacts: float
    total_scores: int
    stem_breakdown: List[StatsResponse]


# Authentication Schemas
class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    code: str
    role: str = "guest"
    avatar_url: Optional[str] = None


class SendVerificationResponse(BaseModel):
    email: str
    message: str


class VerifyCodeRequest(BaseModel):
    email: EmailStr
    code: str


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int  # 保持为 int，在序列化时转为字符串
    username: str
    email: str
    role: str
    avatar_url: Optional[str] = None
    is_active: bool
    is_approved: bool
    created_at: datetime

    class Config:
        from_attributes = True

    @field_serializer('id')
    def serialize_id(self, value: int, _info) -> str:
        """将 ID 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)


class RegisterResponse(BaseModel):
    """Registration response - either a user (for guest) or application submission message"""
    id: int  # 保持为 int，在序列化时转为字符串
    username: str
    email: str
    role: str
    avatar_url: Optional[str] = None
    is_active: Optional[bool] = None
    is_approved: Optional[bool] = None
    created_at: Optional[datetime] = None
    message: Optional[str] = None  # "application_submitted" for pending applications

    class Config:
        from_attributes = True

    @field_serializer('id')
    def serialize_id(self, value: int, _info) -> str:
        """将 ID 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)


class PendingUserResponse(BaseModel):
    id: int  # 保持为 int，在序列化时转为字符串
    username: str
    email: str
    role: str
    created_at: datetime
    source: str = "pending_application"

    class Config:
        from_attributes = True

    @field_serializer('id')
    def serialize_id(self, value: int, _info) -> str:
        """将 ID 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)


class OutboxEmailResponse(BaseModel):
    id: int  # 保持为 int，在序列化时转为字符串
    to_email: str
    subject: str
    body: str
    status: str
    attempts: int
    last_error: Optional[str] = None
    created_at: datetime
    sent_at: Optional[datetime] = None
    alert_count: int
    alerted: bool
    last_alert_at: Optional[datetime] = None

    class Config:
        from_attributes = True

    @field_serializer('id')
    def serialize_id(self, value: int, _info) -> str:
        """将 ID 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)


# Admin Management Schemas
class UserUpdateRequest(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    is_approved: Optional[bool] = None
    avatar_url: Optional[str] = None


class UserListResponse(BaseModel):
    id: int  # 保持为 int，在序列化时转为字符串
    username: str
    email: str
    role: str
    avatar_url: Optional[str] = None
    is_active: bool
    is_approved: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

    @field_serializer('id')
    def serialize_id(self, value: int, _info) -> str:
        """将 ID 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)


class PaginatedUserListResponse(BaseModel):
    """用户列表分页响应（确保大整数 ID 以字符串形式返回，避免 JS 精度丢失）"""
    items: List[UserListResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class UserListQuery(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    is_approved: Optional[bool] = None
    page: int = 1
    page_size: int = 20
    search: Optional[str] = None  # 搜索用户名或邮箱


# Audio Resource Schemas
class AudioResourceCreate(BaseModel):
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[str] = None
    is_public: bool = True


class AudioResourceUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[str] = None
    is_public: Optional[bool] = None


class AudioResourceResponse(BaseModel):
    id: int  # 保持为 int，但在序列化时转换为字符串
    title: str
    description: Optional[str] = None
    file_path: str
    file_size: Optional[int] = None
    duration: Optional[float] = None
    file_format: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[str] = None
    uploader_id: int  # 保持为 int，但在序列化时转换为字符串
    created_by: Optional[str] = None  # 上传者显示名称（"官方"或用户名）
    is_public: bool
    download_count: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
    
    @field_serializer('id')
    def serialize_id(self, value: int, _info) -> str:
        """将 ID 序列化为字符串，避免大整数精度丢失"""
        return str(value)
    
    @field_serializer('uploader_id')
    def serialize_uploader_id(self, value: int, _info) -> str:
        """将 uploader_id 序列化为字符串，避免大整数精度丢失"""
        return str(value)


class AudioResourceListQuery(BaseModel):
    category: Optional[str] = None
    is_public: Optional[bool] = None
    page: int = 1
    page_size: int = 20
    search: Optional[str] = None  # 搜索标题或描述
