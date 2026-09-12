from sqlalchemy import Column, Integer, BigInteger, String, Float, DateTime, Text, Enum as SQLEnum, Boolean, UniqueConstraint, event
from sqlalchemy.sql import func
from app.database import Base
from app.utils import generate_id
import enum


class TaskStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Algorithm(str, enum.Enum):
    """
    分离算法枚举。
    - 保留原有 4 个占位算法，兼容已有数据；
    - 新增与 Music-Source-Separation-Training 对应的关键算法，用于论文对比。
    """
    # 旧占位（仍然保留，避免破坏历史数据）
    DEMUCS_V4 = "Demucs v4"
    SPLEETER = "Spleeter"
    OPENUNMIX = "OpenUnmix"
    BANDSPLITRNN = "BandSplitRNN"

    # ZFTurbo: Music-Source-Separation-Training 重点模型（与 README 中 key 对应）
    MDX23C = "MDX23C"  # key: mdx23c
    DEMUCS4HT = "Demucs4HT"  # key: htdemucs
    BAND_SPLIT_ROFORMER = "Band Split RoFormer"  # key: bs_roformer
    SCNET = "SCNet"  # key: scnet


class Role(str, enum.Enum):
    EXPERT = "expert"
    ADMIN = "admin"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint('email', 'role', name='uq_user_email_role'),
    )

    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    username = Column(String(100, collation='utf8mb4_bin'), unique=True, index=True, nullable=False)
    email = Column(String(255), index=True, nullable=False)  # 移除unique=True，改为联合唯一约束
    password_hash = Column(String(255), nullable=False)
    # 默认角色调整为 EXPERT，系统仅保留"管理员 / 专家"两种身份
    role = Column(SQLEnum(Role), default=Role.EXPERT, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_approved = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, onupdate=func.now())


class PendingUser(Base):
    __tablename__ = "pending_users"
    __table_args__ = (
        UniqueConstraint('email', 'role', name='uq_pending_user_email_role'),
    )

    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    username = Column(String(100), nullable=False)
    email = Column(String(255), index=True, nullable=False)  # 移除unique=True，改为联合唯一约束
    password_hash = Column(String(255), nullable=False)
    role = Column(SQLEnum(Role), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class EmailVerification(Base):
    __tablename__ = "email_verifications"

    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    email = Column(String(255), index=True, nullable=False)
    code = Column(String(10), nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    is_used = Column(Boolean, default=False, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    sent = Column(Boolean, default=False, nullable=False)
    send_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class OutboxEmail(Base):
    __tablename__ = "outbox_emails"

    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    to_email = Column(String(255), nullable=False)
    subject = Column(String(500), nullable=False)
    body = Column(Text, nullable=False)
    status = Column(String(20), default="pending", nullable=False)  # pending, sent, failed
    attempts = Column(Integer, default=0, nullable=False)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    sent_at = Column(DateTime(timezone=True), nullable=True)
    alert_count = Column(Integer, default=0, nullable=False)
    alerted = Column(Boolean, default=False, nullable=False)
    last_alert_at = Column(DateTime(timezone=True), nullable=True)


class SeparationTask(Base):
    __tablename__ = "separation_tasks"

    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    user_id = Column(String(255), index=True)
    original_filename = Column(String(255))
    file_path = Column(String(500))
    algorithm = Column(SQLEnum(Algorithm))
    status = Column(SQLEnum(TaskStatus), default=TaskStatus.PENDING)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    
    # 客观指标
    sdr = Column(Float, nullable=True)
    sir = Column(Float, nullable=True)
    sar = Column(Float, nullable=True)
    # 结构化任务元数据（JSON字符串）：例如 model_version / si_sdr 等
    metadata_json = Column(Text, nullable=True)
    comment = Column(Text, nullable=True)


class StemFile(Base):
    __tablename__ = "stem_files"

    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    task_id = Column(BigInteger, index=True)
    stem_name = Column(String(50))  # Vocals, Drums, Bass, Other
    file_path = Column(String(500))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Score(Base):
    __tablename__ = "scores"
    __table_args__ = (UniqueConstraint("user_id", "blind_sample_id", name="uq_scores_user_blind_sample"),)

    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    user_id = Column(String(255), index=True)
    task_id = Column(BigInteger, index=True)
    blind_sample_id = Column(BigInteger, nullable=True, index=True)
    algorithm = Column(SQLEnum(Algorithm))
    # 主观评分维度：增加 stem_name，将评分细化到单一声源
    stem_name = Column(String(50), nullable=True, index=True)  # Vocals, Drums, Bass, Other
    quality = Column(Integer)  # 1-5
    interference = Column(Integer)  # 1-5
    artifacts = Column(Integer)  # 1-5
    overall_acceptability = Column(Integer, nullable=True)  # 1-5
    segment_start = Column(Float, nullable=True)  # seconds within the 15-second clip
    segment_end = Column(Float, nullable=True)
    issue_tags = Column(Text, nullable=True)  # JSON array of standardized labels
    issue_annotations = Column(Text, nullable=True)  # JSON array: tag/start/end/note per issue
    reliability = Column(Integer, nullable=True)  # 1-5, expert confidence
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, onupdate=func.now())
    version = Column(Integer, nullable=False, default=1)
    last_modified_by = Column(String(255), nullable=True)
    modification_reason = Column(String(500), nullable=True)
    is_deleted = Column(Boolean, nullable=False, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(String(255), nullable=True)
    delete_reason = Column(String(500), nullable=True)


class BlindSample(Base):
    """真实 15 秒试听样本及其仅后台可见的算法映射。"""
    __tablename__ = "blind_samples"
    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    blind_code = Column(String(64), unique=True, index=True, nullable=False)
    task_id = Column(BigInteger, index=True, nullable=False)
    algorithm = Column(SQLEnum(Algorithm), nullable=False)
    stem_name = Column(String(50), nullable=False, index=True)
    start_seconds = Column(Float, nullable=False, default=0.0)
    end_seconds = Column(Float, nullable=False, default=15.0)
    sample_group_key = Column(String(255), nullable=True, index=True)
    file_path = Column(String(500), nullable=False)
    objective_metrics_json = Column(Text, nullable=True)  # 该15秒片段的客观指标
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class BlindExperiment(Base):
    """A comparison batch that groups equivalent clips from multiple algorithms."""
    __tablename__ = "blind_experiments"
    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    name = Column(String(255), nullable=False)
    created_by = Column(String(255), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="active")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class BlindAssignment(Base):
    """One exact blind sample assigned to one expert in an experiment."""
    __tablename__ = "blind_assignments"
    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    experiment_id = Column(BigInteger, nullable=False, index=True)
    blind_sample_id = Column(BigInteger, nullable=False, index=True)
    expert_id = Column(String(255), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="assigned")
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)


class StandardLabel(Base):
    """管理员维护的按声源分类的标准化听感问题标签。"""
    __tablename__ = "standard_labels"
    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    stem_name = Column(String(50), index=True, nullable=False)
    label = Column(String(100), nullable=False)
    description = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class AudioResource(Base):
    """音频资源，管理员和用户都可以上传"""
    __tablename__ = "audio_resources"

    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    title = Column(String(255), nullable=False)  # 音频标题
    description = Column(Text, nullable=True)  # 音频描述
    file_path = Column(String(500), nullable=False)  # 文件存储路径
    file_size = Column(Integer, nullable=True)  # 文件大小（字节）
    duration = Column(Float, nullable=True)  # 音频时长（秒）
    file_format = Column(String(20), nullable=True)  # 文件格式（mp3, wav等）
    category = Column(String(100), nullable=True)  # 分类标签
    uploader_id = Column(BigInteger, index=True, nullable=False)  # 上传者ID
    created_by = Column(String(100), nullable=True)  # 上传者显示名称（"官方"或用户名）
    is_public = Column(Boolean, default=True, nullable=False)  # 是否公开
    download_count = Column(Integer, default=0, nullable=False)  # 下载次数
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, onupdate=func.now())


class OperationLog(str, enum.Enum):
    """操作类型枚举"""
    USER_CREATE = "user_create"
    USER_UPDATE = "user_update"
    USER_DELETE = "user_delete"
    USER_BATCH_DELETE = "user_batch_delete"
    AUDIO_UPLOAD = "audio_upload"
    AUDIO_UPDATE = "audio_update"
    AUDIO_DELETE = "audio_delete"
    AUDIO_BATCH_DELETE = "audio_batch_delete"
    USER_APPROVE = "user_approve"
    USER_REJECT = "user_reject"
    LOGIN = "login"
    LOGOUT = "logout"
    SYSTEM_CONFIG_UPDATE = "system_config_update"


class SystemLog(Base):
    """系统操作日志"""
    __tablename__ = "system_logs"

    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    user_id = Column(BigInteger, index=True, nullable=True)  # 操作用户ID
    username = Column(String(100), nullable=True)  # 操作用户名
    operation_type = Column(String(50), index=True, nullable=False)  # 操作类型
    resource_type = Column(String(50), nullable=True)  # 资源类型（user, audio等）
    resource_id = Column(BigInteger, nullable=True)  # 资源ID
    description = Column(Text, nullable=True)  # 操作描述
    ip_address = Column(String(50), nullable=True)  # IP地址
    user_agent = Column(String(500), nullable=True)  # 用户代理
    status = Column(String(20), default="success", nullable=False)  # success, failed
    error_message = Column(Text, nullable=True)  # 错误信息
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class SystemConfig(Base):
    """系统配置"""
    __tablename__ = "system_configs"

    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    key = Column(String(100), unique=True, index=True, nullable=False)  # 配置键
    value = Column(Text, nullable=True)  # 配置值（JSON字符串）
    description = Column(String(500), nullable=True)  # 配置描述
    category = Column(String(50), nullable=True)  # 配置分类
    updated_by = Column(BigInteger, nullable=True)  # 最后更新者ID
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Notification(Base):
    """系统通知"""
    __tablename__ = "notifications"

    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    title = Column(String(255), nullable=False)  # 通知标题
    content = Column(Text, nullable=False)  # 通知内容
    type = Column(String(50), default="info", nullable=False)  # info, warning, error, success
    target_type = Column(String(50), nullable=True)  # all, admin, user, specific
    target_id = Column(BigInteger, nullable=True)  # 目标用户ID（如果target_type为specific）
    is_read = Column(Boolean, default=False, nullable=False)  # 是否已读
    read_at = Column(DateTime(timezone=True), nullable=True)  # 阅读时间
    created_by = Column(BigInteger, nullable=True)  # 创建者ID
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)  # 过期时间


class NotificationRead(Base):
    """
    通知已读记录（按用户维度存储）

    设计目标：
    - 每个用户有自己的已读状态；
    - 同一条通知可以被多个用户分别标记为已读；
    - 通过 (user_id, notification_id) 唯一约束避免重复记录。
    """
    __tablename__ = "notification_reads"
    __table_args__ = (
        UniqueConstraint("user_id", "notification_id", name="uq_user_notification_read"),
    )

    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    user_id = Column(BigInteger, index=True, nullable=False)
    notification_id = Column(BigInteger, index=True, nullable=False)
    read_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ExpertMessageStatus(str, enum.Enum):
    """专家建议消息状态"""
    PENDING = "pending"
    ANSWERED = "answered"


class ExpertMessage(Base):
    """
    专家给管理员的站内信 / 建议
    - 由专家创建，管理员在后台查看并回复
    - 不做复杂会话线程，仅一问一答（后续可扩展为多次往返）
    """
    __tablename__ = "expert_messages"

    id = Column(BigInteger, primary_key=True, index=True, default=generate_id)
    expert_id = Column(BigInteger, index=True, nullable=False)  # 专家用户ID
    subject = Column(String(255), nullable=False)  # 主题
    content = Column(Text, nullable=False)  # 建议正文
    reply_content = Column(Text, nullable=True)  # 管理员回复内容
    status = Column(SQLEnum(ExpertMessageStatus), default=ExpertMessageStatus.PENDING, nullable=False)
    is_read_by_admin = Column(Boolean, default=False, nullable=False)
    is_read_by_expert = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    replied_at = Column(DateTime(timezone=True), nullable=True)


# 为所有使用雪花算法的模型添加事件监听器，确保在插入前自动生成ID
def ensure_id(mapper, connection, target):
    """在插入前确保ID已生成"""
    if hasattr(target, 'id') and target.id is None:
        target.id = generate_id()


# 为所有使用BigInteger主键的模型注册事件监听器
models_with_snowflake_id = [
    User, PendingUser, EmailVerification, OutboxEmail,
    SeparationTask, StemFile, BlindSample, Score, StandardLabel, AudioResource,
    SystemLog, SystemConfig, Notification, NotificationRead,
    ExpertMessage,
]

for model in models_with_snowflake_id:
    event.listen(model, 'before_insert', ensure_id)
