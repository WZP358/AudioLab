from pydantic import BaseModel, EmailStr, field_serializer, field_validator
import json
from pydantic import model_validator
from typing import Optional, List
from pydantic import Field
from datetime import datetime
from app.models import TaskStatus, Algorithm, Role, ExpertMessageStatus


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
    si_sdr: Optional[float] = None
    model_version: Optional[str] = None
    comment: Optional[str] = None

    model_config = {"from_attributes": True, "protected_namespaces": ()}

    @field_serializer('id')
    def serialize_id(self, value: int, _info) -> str:
        """将 ID 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)


class PaginatedTaskListResponse(BaseModel):
    """分离任务历史记录分页响应"""
    items: List[TaskResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


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
    waveform_min: Optional[List[float]] = None
    waveform_max: Optional[List[float]] = None
    spectrogram: List[List[float]]
    bit_depth: Optional[int] = None
    frequency_response: Optional[List[float]] = None  # 频率响应曲线（dB值）


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
    si_sdr: Optional[float] = None
    comment: Optional[str] = None


class StemScoreData(BaseModel):
    """单个源的评分数据"""
    stem_name: str  # Vocals, Drums, Bass, Other
    quality: int  # 1-5
    interference: int  # 1-5
    artifacts: int  # 1-5
    overall_acceptability: Optional[int] = None
    segment_start: Optional[float] = 0.0
    segment_end: Optional[float] = 15.0
    issue_tags: List[str] = Field(default_factory=list)
    issue_annotations: List[dict] = Field(default_factory=list)
    reliability: Optional[int] = None

    @field_validator('quality', 'interference', 'artifacts', 'overall_acceptability', 'reliability')
    @classmethod
    def validate_score_range(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 5):
            raise ValueError('评分必须在 1-5 之间')
        return v

    @field_validator('stem_name')
    @classmethod
    def validate_stem_name(cls, v: str) -> str:
        if v not in {"Vocals", "Drums", "Bass", "Other"}:
            raise ValueError('声源必须是 Vocals、Drums、Bass 或 Other')
        return v

    @field_validator('issue_tags')
    @classmethod
    def validate_issue_tags(cls, v: List[str]) -> List[str]:
        cleaned = []
        for item in v:
            label = str(item).strip()
            if not label or len(label) > 100:
                raise ValueError('评语标签长度应为 1-100 个字符')
            if label not in cleaned:
                cleaned.append(label)
        if len(cleaned) > 20:
            raise ValueError('单次评分最多选择 20 个标签')
        return cleaned

    @field_validator('issue_annotations')
    @classmethod
    def validate_issue_annotations(cls, v: List[dict]) -> List[dict]:
        cleaned = []
        for item in v:
            if not isinstance(item, dict):
                raise ValueError('问题标注必须是对象')
            tag = str(item.get('tag', '')).strip()
            start = float(item.get('start', 0))
            end = float(item.get('end', 15))
            if not tag or len(tag) > 100 or not (0 <= start < end <= 15):
                raise ValueError('问题标注必须包含有效标签及0-15秒时间范围')
            cleaned.append({'tag': tag, 'start': start, 'end': end, 'note': str(item.get('note', '')).strip()[:500]})
        if len(cleaned) > 50:
            raise ValueError('单次评分最多记录50个问题标注')
        return cleaned

    @model_validator(mode='after')
    def validate_segment(self):
        start = 0.0 if self.segment_start is None else float(self.segment_start)
        end = 15.0 if self.segment_end is None else float(self.segment_end)
        if not (0 <= start < end <= 15):
            raise ValueError('问题时间必须满足 0 <= 开始时间 < 结束时间 <= 15 秒')
        self.segment_start = start
        self.segment_end = end
        return self


class ScoreCreateBatch(BaseModel):
    """批量提交主观评分（一次性提交所有源）"""
    task_id: int
    algorithm: Algorithm
    scores: List[StemScoreData]  # 必须包含所有4个源的评分

    @field_validator('scores')
    @classmethod
    def validate_all_stems_present(cls, v: List[StemScoreData]) -> List[StemScoreData]:
        """验证是否包含所有必需的源"""
        required_stems = {"Vocals", "Drums", "Bass", "Other"}
        provided_stems = {score.stem_name for score in v}

        if provided_stems != required_stems:
            missing = required_stems - provided_stems
            extra = provided_stems - required_stems
            error_msg = []
            if missing:
                error_msg.append(f"缺少以下源的评分: {', '.join(sorted(missing))}")
            if extra:
                error_msg.append(f"包含未知的源: {', '.join(sorted(extra))}")
            raise ValueError('; '.join(error_msg))

        return v


class ScoreCreate(BaseModel):
    """单个源的评分提交（保留用于兼容性）"""
    task_id: int
    algorithm: Algorithm
    stem_name: str
    quality: int
    interference: int
    artifacts: int
    overall_acceptability: Optional[int] = None
    segment_start: Optional[float] = 0.0
    segment_end: Optional[float] = 15.0
    issue_tags: List[str] = Field(default_factory=list)
    reliability: Optional[int] = None

    @model_validator(mode='after')
    def validate_score_payload(self):
        normalized = StemScoreData(**self.model_dump(exclude={"task_id", "algorithm"}))
        self.stem_name = normalized.stem_name
        self.overall_acceptability = normalized.overall_acceptability
        self.segment_start = normalized.segment_start
        self.segment_end = normalized.segment_end
        self.issue_tags = normalized.issue_tags
        self.reliability = normalized.reliability
        return self


class ScoreUpdate(BaseModel):
    """管理员或专家更新评分时使用的请求体（字段可选）"""
    quality: Optional[int] = None
    interference: Optional[int] = None
    artifacts: Optional[int] = None
    overall_acceptability: Optional[int] = None
    segment_start: Optional[float] = None
    segment_end: Optional[float] = None
    issue_tags: Optional[List[str]] = None
    reliability: Optional[int] = None
    reason: Optional[str] = Field(default=None, max_length=500)

    @field_validator('quality', 'interference', 'artifacts', 'overall_acceptability', 'reliability')
    @classmethod
    def validate_optional_score_range(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 5):
            raise ValueError('评分必须在 1-5 之间')
        return v

    @model_validator(mode='after')
    def validate_optional_segment(self):
        if self.segment_start is not None and not (0 <= self.segment_start < 15):
            raise ValueError('开始时间必须在 0-15 秒内')
        if self.segment_end is not None and not (0 < self.segment_end <= 15):
            raise ValueError('结束时间必须在 0-15 秒内')
        if self.segment_start is not None and self.segment_end is not None and self.segment_start >= self.segment_end:
            raise ValueError('开始时间必须早于结束时间')
        return self


class ScoreResponse(BaseModel):
    id: int  # 保持为 int，在序列化时转为字符串
    user_id: str
    task_id: int  # 保持为 int，在序列化时转为字符串
    blind_sample_id: Optional[int] = None
    algorithm: Algorithm
    stem_name: str | None = None
    quality: int
    interference: int
    artifacts: int
    overall_acceptability: Optional[int] = None
    segment_start: Optional[float] = None
    segment_end: Optional[float] = None
    issue_tags: Optional[List[str]] = None
    reliability: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True

    @field_validator('issue_tags', mode='before')
    @classmethod
    def parse_issue_tags(cls, value):
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                return parsed if isinstance(parsed, list) else []
            except Exception:
                return []
        return value or []

    @field_serializer('id')
    def serialize_id(self, value: int, _info) -> str:
        """将 ID 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)

    @field_serializer('task_id')
    def serialize_task_id(self, value: int, _info) -> str:
        """将 task_id 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)

    @field_serializer('blind_sample_id')
    def serialize_blind_sample_id(self, value: Optional[int], _info):
        return str(value) if value is not None else None


class BlindScoreCreate(BaseModel):
    blind_code: str
    quality: int
    interference: int
    artifacts: int
    overall_acceptability: int
    segment_start: float = 0.0
    segment_end: float = 15.0
    issue_tags: List[str] = Field(default_factory=list)
    issue_annotations: List[dict] = Field(default_factory=list)
    reliability: int

    @model_validator(mode='after')
    def validate_blind_score(self):
        normalized = StemScoreData(
            stem_name="Vocals",
            quality=self.quality,
            interference=self.interference,
            artifacts=self.artifacts,
            overall_acceptability=self.overall_acceptability,
            segment_start=self.segment_start,
            segment_end=self.segment_end,
            issue_tags=self.issue_tags,
            issue_annotations=self.issue_annotations,
            reliability=self.reliability,
        )
        self.issue_tags = normalized.issue_tags
        self.segment_start = normalized.segment_start
        self.segment_end = normalized.segment_end
        self.issue_annotations = normalized.issue_annotations
        if not self.blind_code.strip() or len(self.blind_code) > 64:
            raise ValueError('盲化样本编号无效')
        self.blind_code = self.blind_code.strip()
        return self


class BlindScoreBatchCreate(BaseModel):
    """一次提交同一实验批次内多个盲化声源评分。"""
    scores: List[BlindScoreCreate] = Field(min_length=1, max_length=4)

    @model_validator(mode='after')
    def validate_unique_codes(self):
        codes = [item.blind_code for item in self.scores]
        if len(codes) != len(set(codes)):
            raise ValueError('批量盲化评分中不能重复提交同一个样本')
        return self


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


class ObjectiveAlgorithmStats(BaseModel):
    """
    按算法聚合的客观指标统计，用于可视化雷达图等。
    说明：
    - 仅统计已有 sdr/sir/sar 的任务（例如 HTTP 引擎或 mock 引擎返回了客观指标）。
    """

    algorithm: Algorithm
    count_tasks: int
    avg_sdr: Optional[float] = None
    avg_sir: Optional[float] = None
    avg_sar: Optional[float] = None
    avg_si_sdr: Optional[float] = None


class SubjectiveObjectivePoint(BaseModel):
    """
    单条"主观 + 客观"联合样本点：
    - 通过 task_id + algorithm 关联 Score 与 SeparationTask
    - 前端可据此绘制"主观评分 vs SDR/SIR/SAR"的散点图与回归线
    """

    task_id: int  # 在序列化时转为字符串，避免前端精度丢失
    algorithm: Algorithm
    stem_name: Optional[str] = None
    quality: float
    interference: float
    artifacts: float
    soc: Optional[float] = None
    sdr: Optional[float] = None
    sir: Optional[float] = None
    sar: Optional[float] = None
    si_sdr: Optional[float] = None

    @field_serializer("task_id")
    def serialize_task_id(self, value: int, _info) -> str:
        """将 task_id 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)


class ObjectiveAlgorithmDistribution(BaseModel):
    """
    按算法返回 SDR 样本分布，用于前端做箱线图/散点分布可视化。
    - 不在后端做复杂分位数计算，直接返回样本列表，交给前端灵活绘制。
    """

    algorithm: Algorithm
    sdr_values: List[float]


class SocQualityCorrelationResponse(BaseModel):
    algorithm: Optional[Algorithm] = None
    stem_name: Optional[str] = None
    n_samples: int
    spearman_rho: float
    p_value_one_sided: float
    direction: str = "negative"  # 期望 SOC 与 Quality 呈负相关


class ObjectiveSignificanceRequest(BaseModel):
    """
    配对显著性检验请求：
    - algorithm_a / algorithm_b：待比较算法
    - metric：比较指标（sdr/sir/sar/si_sdr）
    """
    algorithm_a: Algorithm
    algorithm_b: Algorithm
    metric: str = "si_sdr"

    @field_validator("metric")
    @classmethod
    def validate_metric(cls, v: str) -> str:
        allowed = {"sdr", "sir", "sar", "si_sdr"}
        vv = (v or "").strip().lower()
        if vv not in allowed:
            raise ValueError(f"metric 必须是 {', '.join(sorted(allowed))}")
        return vv


class ObjectiveSignificanceResponse(BaseModel):
    algorithm_a: Algorithm
    algorithm_b: Algorithm
    metric: str
    n_pairs: int
    w_stat: float
    z_score: Optional[float] = None
    p_value: float
    effect_size_rbc: Optional[float] = None
    significant: bool


# Authentication Schemas
class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    code: str
    # 系统仅支持 expert / admin 两种角色，默认注册为 expert
    role: str = "expert"


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
    is_active: bool
    is_approved: bool
    created_at: datetime

    class Config:
        from_attributes = True

    @field_serializer('id')
    def serialize_id(self, value: int, _info) -> str:
        """将 ID 序列化为字符串，避免前端大整数精度丢失"""
        return str(value)


class SelfUserUpdateRequest(BaseModel):
    """当前登录用户自助更新资料时使用的请求体"""
    username: Optional[str] = None
    # 修改密码时必须同时提供 old_password 和 new_password
    old_password: Optional[str] = None
    new_password: Optional[str] = None


class RegisterResponse(BaseModel):
    """Registration response - registration always goes through application / approval flow"""
    id: int  # 保持为 int，在序列化时转为字符串
    username: str
    email: str
    role: str
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


class UserListResponse(BaseModel):
    id: int  # 保持为 int，在序列化时转为字符串
    username: str
    email: str
    role: str
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
    is_public: bool = True


class AudioResourceUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
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


# ========== 专家建议 / 站内信 Schemas ==========

class ExpertMessageCreate(BaseModel):
    """专家发送给管理员的建议/消息创建请求"""
    subject: str
    content: str


class ExpertMessageResponse(BaseModel):
    """专家建议/消息响应体"""
    id: int
    expert_id: int
    subject: str
    content: str
    reply_content: Optional[str] = None
    status: ExpertMessageStatus
    is_read_by_admin: bool
    is_read_by_expert: bool
    created_at: datetime
    replied_at: Optional[datetime] = None

    class Config:
        from_attributes = True

    @field_serializer("id")
    def serialize_id(self, value: int, _info) -> str:
        return str(value)

    @field_serializer("expert_id")
    def serialize_expert_id(self, value: int, _info) -> str:
        return str(value)


class PaginatedExpertMessageResponse(BaseModel):
    """分页的专家消息列表（管理员视图）"""
    items: List[ExpertMessageResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class AdminReplyRequest(BaseModel):
    """管理员回复专家建议"""
    reply_content: str
