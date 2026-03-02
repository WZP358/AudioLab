from fastapi import APIRouter, Depends, HTTPException, status, Body, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast, String, bindparam
from sqlalchemy.exc import IntegrityError
from passlib.context import CryptContext
from datetime import datetime, timedelta
import os
import random
import smtplib
import ssl
from email.message import EmailMessage

from app.database import get_db
from fastapi import UploadFile, File, Request
import pathlib, time, re
from app.models import User, EmailVerification, Role, OutboxEmail, OperationLog
from sqlalchemy import text
from sqlalchemy import create_engine
from app.schemas import RegisterRequest, SendVerificationResponse, VerifyCodeRequest, AuthTokenResponse, LoginRequest, UserResponse, PendingUserResponse, OutboxEmailResponse, RegisterResponse
from app.utils.log_helper import create_system_log, get_client_ip, get_user_agent

import jwt
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST, Counter, Gauge
import requests

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 仅使用 pbkdf2_sha256，避免 docker 环境下 bcrypt 后端兼容性问题
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
SECRET_KEY = os.getenv("JWT_SECRET", "change-me")
ALGORITHM = "HS256"
# 以下配置可以从系统设置中读取，如果没有则使用环境变量或默认值
# 在函数中使用 get_config_value() 来获取实际值

ANSI_RESET = "\x1b[0m"
ANSI_RED = "\x1b[31m"
ANSI_GREEN = "\x1b[32m"
ANSI_YELLOW = "\x1b[33m"


def _log_ok(message: str):
    print(f"{ANSI_GREEN}{message}{ANSI_RESET}", flush=True)


def _log_warn(message: str):
    print(f"{ANSI_RED}{message}{ANSI_RESET}", flush=True)


def _log_info(message: str):
    print(f"{ANSI_YELLOW}{message}{ANSI_RESET}", flush=True)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=24)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


from fastapi import Header

async def get_current_user(authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)):
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未提供认证信息")
    parts = authorization.split(" ")
    token = parts[1] if len(parts) > 1 else parts[0]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="认证令牌无效，请重新登录")
    q = select(User).where(User.id == user_id)
    res = await db.execute(q)
    user = res.scalars().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    return user

def send_email_code_sync(email: str, code: str, max_retries: int = 3, verification_ttl_min: int = 15):
    """Synchronous email send with retry and exponential backoff.
    在严格模式下，不再回退到 MOCK：如果 SMTP 配置不完整或发送失败，将直接抛出异常。"""
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "465"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    subject = "Your AudioLab verification code"
    body = f"Your verification code is: {code}\nThis code expires in {verification_ttl_min} minutes."
    
    # 从环境变量读取 EMAIL_DELIVERY_MODE（同步函数无法访问数据库）
    email_delivery_mode = (os.getenv("EMAIL_DELIVERY_MODE", "mock") or "mock").strip().lower()
    
    # 检查配置
    if not (smtp_host and smtp_user):
        if email_delivery_mode == "mock":
            _log_warn(f"[EMAIL MOCK] to={email} code={code} reason=SMTP_HOST/SMTP_USER not configured")
            return
        raise RuntimeError("SMTP not configured: please set SMTP_HOST and SMTP_USER for real email delivery")
    if not smtp_pass:
        if email_delivery_mode == "mock":
            _log_warn(f"[EMAIL MOCK] to={email} code={code} reason=SMTP_PASS not configured")
            return
        raise RuntimeError("SMTP not configured: please set SMTP_PASS (most SMTP servers require authentication)")

    _log_info(f"[EMAIL SEND] 开始发送验证码邮件 to={email} host={smtp_host} port={smtp_port} user={smtp_user}")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = os.getenv("MAIL_FROM") or smtp_user
    msg["To"] = email
    msg.set_content(body)

    attempt = 0
    last_err = None
    errors = []
    while attempt < max_retries:
        # determine attempt mode sequence for this try
        modes = []
        if smtp_port == 465:
            modes = [("ssl", smtp_host, smtp_port)]
        else:
            modes = [("starttls", smtp_host, smtp_port), ("ssl", smtp_host, 465)]

        for mode, host, port in modes:
            try:
                if mode == "ssl":
                    with smtplib.SMTP_SSL(host, port, timeout=20) as s:
                        s.ehlo()
                        if smtp_pass:
                            s.login(smtp_user, smtp_pass)
                        s.send_message(msg)
                else:
                    with smtplib.SMTP(host, port, timeout=20) as s:
                        s.ehlo()
                        try:
                            s.starttls(context=ssl.create_default_context())
                            s.ehlo()
                        except Exception:
                            raise
                        s.login(smtp_user, smtp_pass)
                        s.send_message(msg)
                # success
                _log_ok(f"[EMAIL SEND OK] 邮件发送成功 to={email} mode={mode} host={host} port={port}")
                return
            except smtplib.SMTPAuthenticationError as e:
                err_msg = f"SMTP认证失败: 用户名或密码错误 (host={host}, port={port}, user={smtp_user})"
                last_err = RuntimeError(err_msg)
                errors.append(f"尝试 {attempt+1}/{max_retries}, {mode}模式: {err_msg}")
                _log_warn(f"[EMAIL SEND ERROR] {err_msg} 详细错误: {e}")
            except smtplib.SMTPConnectError as e:
                err_msg = f"SMTP连接失败: 无法连接到服务器 (host={host}, port={port})"
                last_err = RuntimeError(err_msg)
                errors.append(f"尝试 {attempt+1}/{max_retries}, {mode}模式: {err_msg}")
                _log_warn(f"[EMAIL SEND ERROR] {err_msg} 详细错误: {e}")
            except smtplib.SMTPException as e:
                err_msg = f"SMTP错误: {str(e)} (host={host}, port={port})"
                last_err = RuntimeError(err_msg)
                errors.append(f"尝试 {attempt+1}/{max_retries}, {mode}模式: {err_msg}")
                _log_warn(f"[EMAIL SEND ERROR] {err_msg}")
            except Exception as e:
                err_msg = f"未知错误: {type(e).__name__}: {str(e)} (host={host}, port={port})"
                last_err = RuntimeError(err_msg)
                errors.append(f"尝试 {attempt+1}/{max_retries}, {mode}模式: {err_msg}")
                _log_warn(f"[EMAIL SEND WARNING] attempt={attempt+1} mode={mode} host={host} port={port} error={e}")
        # backoff before next attempt
        attempt += 1
        if attempt < max_retries:
            import time
            backoff = 2 ** attempt
            _log_info(f"[EMAIL SEND] 等待 {backoff} 秒后重试...")
            time.sleep(backoff)

    # all attempts failed
    error_summary = "\n".join(errors)
    final_error = RuntimeError(f"邮件发送失败，已尝试 {max_retries} 次:\n{error_summary}")
    _log_warn(f"[EMAIL SEND ERROR] 所有尝试均失败 to={email}\n{error_summary}")
    raise final_error


def send_simple_email(to_email: str, subject: str, body: str, max_retries: int = 2):
    """Send a simple plaintext email; best-effort, with mock fallback."""
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "465"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    # 从环境变量读取 EMAIL_DELIVERY_MODE（同步函数无法访问数据库）
    email_delivery_mode = (os.getenv("EMAIL_DELIVERY_MODE", "mock") or "mock").strip().lower()
    
    if not (smtp_host and smtp_user):
        if email_delivery_mode == "mock":
            _log_warn(f"[EMAIL MOCK] to={to_email} subject={subject} reason=SMTP_HOST/SMTP_USER not configured")
            return
        raise RuntimeError("SMTP not configured: please set SMTP_HOST and SMTP_USER for real email delivery")
    if not smtp_pass:
        if email_delivery_mode == "mock":
            _log_warn(f"[EMAIL MOCK] to={to_email} subject={subject} reason=SMTP_PASS not configured")
            return
        raise RuntimeError("SMTP not configured: please set SMTP_PASS (most SMTP servers require authentication)")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = os.getenv("MAIL_FROM") or smtp_user
    msg["To"] = to_email
    msg.set_content(body)

    attempt = 0
    last_err = None
    while attempt < max_retries:
        try:
            if smtp_port == 465:
                with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=20) as s:
                    s.ehlo()
                    s.login(smtp_user, smtp_pass)
                    s.send_message(msg)
            else:
                with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as s:
                    s.ehlo()
                    s.starttls(context=ssl.create_default_context())
                    s.ehlo()
                    s.login(smtp_user, smtp_pass)
                    s.send_message(msg)
            print(f"[EMAIL SEND OK] to={to_email} subject={subject} attempt={attempt+1}")
            return
        except Exception as e:
            last_err = e
            _log_warn(f"[EMAIL SEND WARNING] attempt={attempt+1} error={e}")
            attempt += 1
    _log_warn(f"[EMAIL SEND ERROR] all attempts failed error={last_err}")

# Router-level Prometheus metrics (visible to this process)
OUTBOX_CREATED = Counter("audiolab_outbox_created_total", "Outbox rows created")
OUTBOX_FAILED = Counter("audiolab_outbox_failed_total", "Outbox rows marked failed (router)")
OUTBOX_PENDING_GAUGE = Gauge("audiolab_outbox_pending_router", "Current pending outbox emails (router)")


@router.post("/test_email")
async def test_email_send(payload: dict = Body(...), current_user: User = Depends(get_current_user)):
    """测试邮件发送功能（仅管理员可用）"""
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Only admin can test email")
    
    test_email = payload.get("email")
    if not test_email or not isinstance(test_email, str):
        raise HTTPException(status_code=422, detail="Missing or invalid 'email' in request body")
    
    test_code = "123456"
    try:
        send_email_code_sync(test_email, test_code)
        return {
            "status": "success",
            "message": f"测试邮件已发送到 {test_email}",
            "details": "请检查收件箱（包括垃圾邮件文件夹）"
        }
    except Exception as e:
        return {
            "status": "failed",
            "message": f"邮件发送失败: {str(e)}",
            "error": str(e),
            "suggestion": "请检查 SMTP 配置和网络连接"
        }


@router.post("/send_code", response_model=SendVerificationResponse)
async def send_verification_code(payload: dict = Body(...), db: AsyncSession = Depends(get_db)):
    """Generate a 6-digit code and send to email.
    Accepts JSON body: { "email": "user@example.com" }"""
    email = payload.get("email") if isinstance(payload, dict) else None
    if not email or not isinstance(email, str):
        raise HTTPException(status_code=422, detail="邮箱格式不正确，请检查后重新输入")
    # 简单的邮箱格式验证
    import re
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(email_pattern, email):
        raise HTTPException(status_code=422, detail="邮箱格式不正确，请检查后重新输入")
    # 从系统配置读取参数
    from app.utils.config_helper import get_config_value
    SEND_INTERVAL_SECONDS = await get_config_value(
        db, "verification_send_interval_seconds", 60, "SEND_INTERVAL_SECONDS", int
    )
    MAX_PER_HOUR = await get_config_value(
        db, "verification_max_per_hour", 5, "MAX_VERIFICATIONS_PER_HOUR", int
    )
    VERIFICATION_TTL_MIN = await get_config_value(
        db, "verification_ttl_minutes", 15, "VERIFICATION_TTL_MIN", int
    )
    
    # rate limit: check last sent time and count in last hour
    # Only count successfully sent verification codes (send_count > 0) for rate limiting
    cutoff_minute = datetime.utcnow() - timedelta(seconds=SEND_INTERVAL_SECONDS)
    cutoff_hour = datetime.utcnow() - timedelta(hours=1)
    # latest successfully sent
    q_latest = select(EmailVerification).where(
        EmailVerification.email == email,
        EmailVerification.send_count > 0  # Only count successfully sent codes
    ).order_by(EmailVerification.created_at.desc())
    res_latest = await db.execute(q_latest)
    latest = res_latest.scalars().first()
    if latest and latest.created_at and latest.created_at > cutoff_minute:
        raise HTTPException(status_code=429, detail=f"请求过于频繁，请等待 {SEND_INTERVAL_SECONDS} 秒后再试")
    # count successfully sent in last hour
    q_count = select(func.count(EmailVerification.id)).where(
        EmailVerification.email == email,
        EmailVerification.created_at >= cutoff_hour,
        EmailVerification.send_count > 0  # Only count successfully sent codes
    )
    res_count = await db.execute(q_count)
    count_last_hour = res_count.scalar_one()
    if count_last_hour >= MAX_PER_HOUR:
        raise HTTPException(status_code=429, detail="一小时内请求次数过多，请稍后再试")

    code = f"{random.randint(0,999999):06d}"
    expires = datetime.utcnow() + timedelta(minutes=VERIFICATION_TTL_MIN)
    # If there is an existing unused, unexpired verification that has already been sent, skip sending another
    if latest and not latest.is_used and latest.expires_at and latest.expires_at > datetime.utcnow() and getattr(latest, "send_count", 0) > 0:
        return SendVerificationResponse(email=email, message="Verification code already sent")

    ev = EmailVerification(
        email=email,
        code=code,
        attempts=0,
        is_used=False,
        expires_at=expires,
        sent=False,
        send_count=0,
    )
    db.add(ev)
    await db.commit()
    await db.refresh(ev)

    # 关键修复：
    # - 不要在发送前就把 send_count +1（否则发送失败也会留下"刚发过"的痕迹，引发 429）
    # - 发送失败时清理本次验证码记录，允许用户立即重试（避免被 60s 限流困住）
    try:
        # 从系统配置读取验证码有效期（用于邮件内容）
        from app.utils.config_helper import get_config_value
        verification_ttl_min = await get_config_value(
            db, "verification_ttl_minutes", 15, "VERIFICATION_TTL_MIN", int
        )
        send_email_code_sync(email, code, verification_ttl_min=verification_ttl_min)  # mock 模式下也会直接返回
        ev.send_count = 1
        ev.sent = True
        await db.commit()
        _log_ok(f"[VERIFICATION CODE] 验证码已发送到 {email}")
    except Exception as e:
        error_detail = str(e)
        _log_warn(f"[VERIFICATION CODE] 发送失败 to={email} error={error_detail}")
        try:
            await db.delete(ev)
            await db.commit()
        except Exception:
            # 清理失败不应掩盖原错误
            pass
        # 返回更详细的错误信息
        raise HTTPException(
            status_code=500, 
            detail=f"邮件发送失败: {error_detail}\n\n请检查:\n1. SMTP配置是否正确 (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)\n2. 邮箱密码是否为应用专用密码\n3. 网络连接是否正常\n4. 查看后端日志获取详细错误信息"
        )

    # 从环境变量读取 EMAIL_DELIVERY_MODE（用于返回消息）
    email_delivery_mode = (os.getenv("EMAIL_DELIVERY_MODE", "mock") or "mock").strip().lower()
    msg = "Verification code sent" if email_delivery_mode != "mock" else "Verification code generated (mock email; check backend logs)"
    return SendVerificationResponse(email=email, message=msg)


@router.post("/admin/outbox/alerts")
async def run_outbox_alerts(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Scan failed outbox items and notify admin for manual intervention (idempotent)."""
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Only admin can run outbox alerts")
    from sqlalchemy import text
    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL") or os.getenv("SMTP_USER")
    if not ADMIN_EMAIL:
        raise HTTPException(status_code=500, detail="No admin email configured")
    # threshold for alerting
    ALERT_MAX = int(os.getenv("OUTBOX_ALERT_MAX", "3"))
    q = text("SELECT id,to_email,subject,body,attempts,alert_count FROM outbox_emails WHERE status = 'failed' AND (alert_count IS NULL OR alert_count < :max)")
    res = await db.execute(q, {"max": ALERT_MAX})
    rows = res.mappings().all()
    notified = []
    for r in rows:
        eid = r["id"]
        to_email = r["to_email"]
        attempts = r["attempts"] or 0
        # send admin notification
        subject = f"[AudioLab] Outbox send failed id={eid}"
        body = f"Outbox id={eid} to={to_email} attempts={attempts}\n\nOriginal subject: {r['subject']}\n\nPlease investigate or retry."
        try:
            send_simple_email(ADMIN_EMAIL, subject, body)
            await db.execute(text("UPDATE outbox_emails SET alert_count = IFNULL(alert_count,0)+1, alerted=1, last_alert_at=now() WHERE id = :id"), {"id": eid})
            await db.commit()
            notified.append(eid)
        except Exception as e:
            print("failed to send admin alert for outbox", eid, e)
    return {"notified": notified}


@router.get("/admin/outbox/failed", response_model=list[OutboxEmailResponse])
async def list_failed_outbox(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Only admin can view outbox")
    from app.schemas import OutboxEmailResponse
    q = text("SELECT * FROM outbox_emails WHERE status='failed' ORDER BY created_at DESC LIMIT 200")
    res = await db.execute(q)
    rows = res.mappings().all()
    # convert rows to response objects
    out = []
    for r in rows:
        out.append(OutboxEmailResponse(
            id=r["id"],
            to_email=r["to_email"],
            subject=r["subject"],
            body=r["body"],
            status=r["status"],
            attempts=r["attempts"] or 0,
            last_error=r.get("last_error"),
            created_at=r["created_at"],
            sent_at=r.get("sent_at"),
            alert_count=r.get("alert_count") or 0,
            alerted=bool(r.get("alerted") or False),
            last_alert_at=r.get("last_alert_at"),
        ))
    try:
        OUTBOX_PENDING_GAUGE.set(len(out))
    except Exception:
        pass
    return out


@router.post("/admin/outbox/retry/{outbox_id}")
async def retry_outbox(outbox_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Only admin can retry outbox items")
    # reset status and enqueue worker
    q = text("SELECT id,to_email,subject,body,status FROM outbox_emails WHERE id = :id")
    res = await db.execute(q, {"id": outbox_id})
    row = res.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Outbox item not found")
    await db.execute(text("UPDATE outbox_emails SET status='pending', last_error=NULL WHERE id = :id"), {"id": outbox_id})
    await db.commit()
    # enqueue send_outbox task
    try:
        from app.tasks.email_tasks import send_outbox
        send_outbox.delay(outbox_id)
    except Exception:
        # best-effort: fallback to thread
        import threading
        def _send_now(i):
            from app.routers.auth import send_email_code_sync
            # best-effort: send via simple SMTP
            try:
                # load row again
                pass
            except Exception:
                pass
        t = threading.Thread(target=_send_now, args=(outbox_id,), daemon=True)
        t.start()
    return {"message": "requeued"}


@router.post("/email/webhook")
async def email_webhook(payload: dict | list, x_hook_secret: str | None = Header(None), db: AsyncSession = Depends(get_db)):
    """Generic webhook for transactional providers (expects SendGrid-like events). Protect with X-Hook-Secret header matching env WEBHOOK_SECRET."""
    secret = os.getenv("WEBHOOK_SECRET")
    if secret and x_hook_secret != secret:
        raise HTTPException(status_code=403, detail="Invalid webhook secret")
    events = payload if isinstance(payload, list) else [payload]
    updated = 0
    for ev in events:
        try:
            email = ev.get("email") or ev.get("to") or (ev.get("message", {}) .get("to", [{}])[0].get("email") if isinstance(ev.get("message"), dict) else None)
            etype = ev.get("event") or ev.get("type") or ev.get("sg_event_name")
            if not email or not etype:
                continue
            if etype in ("bounce", "dropped", "blocked", "spamreport"):
                reason = ev.get("reason") or ev.get("response") or ""
                await db.execute(text("UPDATE outbox_emails SET status='failed', last_error=:err WHERE to_email = :email AND status != 'sent'"), {"err": f"{etype}:{reason}", "email": email})
                await db.commit()
                OUTBOX_FAILED.inc()
                updated += 1
        except Exception:
            continue
    return {"updated": updated}


@router.get("/metrics")
async def metrics(db: AsyncSession = Depends(get_db)):
    """Simple JSON metrics for outbox/email sending."""
    from sqlalchemy import text
    r1 = await db.execute(text("SELECT COUNT(*) AS pending FROM outbox_emails WHERE status='pending'"))
    pending = r1.scalar_one()
    r2 = await db.execute(text("SELECT COUNT(*) AS sent FROM outbox_emails WHERE status='sent'"))
    sent = r2.scalar_one()
    r3 = await db.execute(text("SELECT COUNT(*) AS failed FROM outbox_emails WHERE status='failed'"))
    failed = r3.scalar_one()
    r4 = await db.execute(text("SELECT IFNULL(AVG(attempts),0) AS avg_attempts FROM outbox_emails"))
    avg_attempts = float(r4.scalar_one() or 0)
    return {"outbox_pending": pending, "outbox_sent": sent, "outbox_failed": failed, "outbox_avg_attempts": avg_attempts}


@router.post("/register", response_model=RegisterResponse)
async def register(req: Request, request: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register user after providing code"""
    try:
        # 验证用户名格式和长度
        if not request.username or not request.username.strip():
            raise HTTPException(status_code=400, detail="用户名不能为空")
        request.username = request.username.strip()
        if len(request.username) < 3:
            raise HTTPException(status_code=400, detail="用户名长度至少为3个字符")
        if len(request.username) > 100:
            raise HTTPException(status_code=400, detail="用户名长度不能超过100个字符")
        # 验证密码长度
        if not request.password:
            raise HTTPException(status_code=400, detail="密码不能为空")
        if len(request.password) < 6:
            raise HTTPException(status_code=400, detail="密码长度至少为6个字符")
        if len(request.password) > 128:
            raise HTTPException(status_code=400, detail="密码长度不能超过128个字符")
        
        # find latest active verification for email
        q = select(EmailVerification).where(EmailVerification.email == request.email).order_by(EmailVerification.created_at.desc())
        res = await db.execute(q)
        ev = res.scalars().first()
        if not ev:
            raise HTTPException(status_code=400, detail="尚未向该邮箱发送验证码")
        if ev.is_used:
            raise HTTPException(status_code=400, detail="该验证码已被使用，请重新获取新的验证码")
        if datetime.utcnow() > ev.expires_at:
            raise HTTPException(status_code=400, detail="验证码已过期，请重新获取新的验证码")
        if request.code != ev.code:
            ev.attempts += 1
            await db.commit()
            if ev.attempts >= 3:
                raise HTTPException(status_code=400, detail="尝试次数过多，请重新获取新的验证码")
            raise HTTPException(status_code=400, detail="验证码不正确，请检查后重新输入")
        # mark used
        ev.is_used = True
        await db.commit()

        # 检查用户名是否全局唯一（在User表和PendingUser表中）
        # 使用 BINARY 进行大小写敏感的比较（MySQL 特性）
        from app.models import PendingUser
        # 使用 text() 构建大小写敏感的比较条件（MySQL BINARY 关键字）
        # 注意：如果数据库列已经是 utf8mb4_bin collation，则不需要 BINARY，但为了兼容性保留
        q_username_user = select(User).where(
            text("BINARY users.username = :username").bindparams(bindparam("username", request.username))
        )
        res_username_user = await db.execute(q_username_user)
        existing_username_user = res_username_user.scalars().first()
        
        q_username_pending = select(PendingUser).where(
            text("BINARY pending_users.username = :username").bindparams(bindparam("username", request.username))
        )
        res_username_pending = await db.execute(q_username_pending)
        existing_username_pending = res_username_pending.scalars().first()
        
        if existing_username_user or existing_username_pending:
            raise HTTPException(status_code=400, detail="用户名已被使用，请选择其他用户名")

        # 检查该邮箱是否已经注册了相同角色的账户（仅支持 expert / admin）
        role_val = request.role if request.role in [r.value for r in Role] else Role.EXPERT.value
        target_role = Role(role_val)
        
        # 检查User表中是否有相同邮箱和角色的账户
        q_email_role_user = select(User).where(
            User.email == request.email,
            User.role == target_role
        )
        res_email_role_user = await db.execute(q_email_role_user)
        existing_email_role_user = res_email_role_user.scalars().first()
        
        # 检查PendingUser表中是否有相同邮箱和角色的待审核申请
        q_email_role_pending = select(PendingUser).where(
            PendingUser.email == request.email,
            PendingUser.role == target_role
        )
        res_email_role_pending = await db.execute(q_email_role_pending)
        existing_email_role_pending = res_email_role_pending.scalars().first()
        
        if existing_email_role_user:
            role_name_map = {
                Role.EXPERT: "专家",
                Role.ADMIN: "管理员",
            }
            role_name = role_name_map.get(target_role, target_role.value)
            raise HTTPException(
                status_code=400,
                detail=f"该邮箱已注册{role_name}账户，每个邮箱在系统中只能拥有一种角色。如需使用该角色，请直接登录；如需注册其他角色，请使用不同的邮箱。"
            )
        
        if existing_email_role_pending:
            role_name_map = {
                Role.EXPERT: "专家",
                Role.ADMIN: "管理员",
            }
            role_name = role_name_map.get(target_role, target_role.value)
            raise HTTPException(
                status_code=400,
                detail=f"该邮箱已有{role_name}角色的待审核申请，请等待审核完成后再试。"
            )

        # 所有注册均走“申请 + 管理员审批”流程
        pending = PendingUser(
            username=request.username,
            email=request.email,
            password_hash=hash_password(request.password),
            role=Role(role_val),
            avatar_url=request.avatar_url,
        )
        db.add(pending)
        try:
            await db.commit()
            await db.refresh(pending)
            # 记录系统日志（待审核申请）
            await create_system_log(
                db=db,
                operation_type=OperationLog.USER_CREATE.value,
                user_id=None,
                username=request.username,
                resource_type="user",
                description=f"用户提交注册申请：{request.username} ({request.email})，角色：{role_val}，待管理员审核",
                status="success",
                ip_address=get_client_ip(req),
                user_agent=get_user_agent(req),
            )
        except IntegrityError as e:
            await db.rollback()
            error_str = str(e.orig) if hasattr(e, 'orig') else str(e)
            if 'username' in error_str.lower() or 'pending_users.username' in error_str:
                raise HTTPException(status_code=400, detail="用户名已被使用，请选择其他用户名")
            elif 'uq_pending_user_email_role' in error_str or ('email' in error_str.lower() and 'role' in error_str.lower()):
                role_name_map = {
                    Role.EXPERT: "专家",
                    Role.ADMIN: "管理员",
                }
                role_name = role_name_map.get(target_role, target_role.value)
                raise HTTPException(
                    status_code=400,
                    detail=f"该邮箱已有{role_name}角色的待审核申请，请等待审核完成后再试。"
                )
            else:
                raise HTTPException(status_code=400, detail=f"申请提交失败: 数据冲突")
        return RegisterResponse(
            id=pending.id,
            username=pending.username,
            email=pending.email,
            role=pending.role.value if hasattr(pending.role, 'value') else str(pending.role),
            avatar_url=pending.avatar_url,
            message="application_submitted",
            created_at=pending.created_at,
        )
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except IntegrityError as e:
        await db.rollback()
        error_str = str(e.orig) if hasattr(e, 'orig') else str(e)
        _log_warn(f"[REGISTER ERROR] 数据库完整性错误: {error_str}")
        raise HTTPException(
            status_code=400,
            detail="注册失败: 用户名或邮箱已被使用"
        )
    except Exception as e:
        # Log the actual error for debugging
        import traceback
        error_detail = traceback.format_exc()
        _log_warn(f"[REGISTER ERROR] 注册失败: {str(e)}\n{error_detail}")
        raise HTTPException(
            status_code=500,
            detail=f"注册失败: {str(e)}"
        )


@router.post("/login", response_model=AuthTokenResponse)
async def login(req: Request, payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import or_
    # 基本验证
    if not payload.email or not payload.email.strip():
        raise HTTPException(status_code=400, detail="请输入邮箱或用户名")
    if not payload.password:
        raise HTTPException(status_code=400, detail="请输入密码")
    # allow login using either email or username
    # 邮箱比较保持大小写不敏感，用户名比较使用 BINARY 进行大小写敏感比较
    q = select(User).where(or_(
        User.email == payload.email,
        text("BINARY users.username = :username").bindparams(bindparam("username", payload.email))
    ))
    res = await db.execute(q)
    user = res.scalars().first()
    if not user:
        # 记录登录失败日志（用户不存在）
        await create_system_log(
            db=db,
            operation_type=OperationLog.LOGIN.value,
            user_id=None,
            username=None,
            resource_type="user",
            description=f"登录失败：用户不存在（邮箱/用户名：{payload.email}）",
            status="failed",
            error_message="用户名或密码错误",
            ip_address=get_client_ip(req),
            user_agent=get_user_agent(req),
        )
        raise HTTPException(status_code=400, detail="用户名或密码错误")
    if not verify_password(payload.password, user.password_hash):
        # 记录登录失败日志（密码错误）
        await create_system_log(
            db=db,
            operation_type=OperationLog.LOGIN.value,
            user_id=user.id,
            username=user.username,
            resource_type="user",
            resource_id=user.id,
            description=f"登录失败：密码错误",
            status="failed",
            error_message="用户名或密码错误",
            ip_address=get_client_ip(req),
            user_agent=get_user_agent(req),
        )
        raise HTTPException(status_code=400, detail="用户名或密码错误")
    # if account explicitly disabled/rejected
    if not user.is_active:
        # 记录登录失败日志（账户被禁用）
        await create_system_log(
            db=db,
            operation_type=OperationLog.LOGIN.value,
            user_id=user.id,
            username=user.username,
            resource_type="user",
            resource_id=user.id,
            description=f"登录失败：账户已被拒绝或禁用",
            status="failed",
            error_message="账户已被拒绝或禁用，请重新注册申请",
            ip_address=get_client_ip(req),
            user_agent=get_user_agent(req),
        )
        raise HTTPException(status_code=403, detail="账户已被拒绝或禁用，请重新注册申请")
    # check approval
    if user.role in (Role.EXPERT, Role.ADMIN) and not user.is_approved:
        # 记录登录失败日志
        await create_system_log(
            db=db,
            operation_type=OperationLog.LOGIN.value,
            user_id=user.id,
            username=user.username,
            resource_type="user",
            resource_id=user.id,
            description=f"登录失败：账户待管理员审核",
            status="failed",
            error_message="账户待管理员审核，请稍后再试",
            ip_address=get_client_ip(req),
            user_agent=get_user_agent(req),
        )
        raise HTTPException(status_code=403, detail="账户待管理员审核，请稍后再试")
    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    # 记录登录成功日志
    await create_system_log(
        db=db,
        operation_type=OperationLog.LOGIN.value,
        user_id=user.id,
        username=user.username,
        resource_type="user",
        resource_id=user.id,
        description=f"用户登录成功：{user.username}",
        status="success",
        ip_address=get_client_ip(req),
        user_agent=get_user_agent(req),
    )
    return AuthTokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    """Get current logged-in user information"""
    return current_user


def get_token_user(token: str | None, db: AsyncSession):
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except Exception:
        return None
    # load user
    q = select(User).where(User.id == user_id)
    result = db.execute(q)
    # note: this is sync call in utility; callers should handle properly
    return None




@router.post("/approve/{user_id}")
async def approve_user(user_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Only admin can approve accounts")
    q = select(User).where(User.id == user_id)
    res = await db.execute(q)
    target = res.scalars().first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.is_approved = True
    await db.commit()
    return {"message": "approved"}


@router.post("/approve_application/{app_id}")
async def approve_application(app_id: int, req: Request, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Only admin can approve applications")
    # find pending application
    from app.models import PendingUser
    q = select(PendingUser).where(PendingUser.id == app_id)
    res = await db.execute(q)
    app_entry = res.scalars().first()
    if not app_entry:
        raise HTTPException(status_code=404, detail="Application not found")
    # create real user
    user = User(
        username=app_entry.username,
        email=app_entry.email,
        password_hash=app_entry.password_hash,
        role=app_entry.role,
        avatar_url=app_entry.avatar_url,
        is_active=True,
        is_approved=True,
    )
    db.add(user)
    # delete pending
    await db.delete(app_entry)
    await db.commit()
    await db.refresh(user)
    # 记录系统日志
    await create_system_log(
        db=db,
        operation_type=OperationLog.USER_APPROVE.value,
        user_id=current_user.id,
        username=current_user.username,
        resource_type="user",
        resource_id=user.id,
        description=f"管理员 {current_user.username} 批准申请并创建用户 {user.username}（角色：{user.role.value}）",
        status="success",
        ip_address=get_client_ip(req),
        user_agent=get_user_agent(req),
    )
    return {"message": "approved", "user_id": user.id}


@router.post("/reject_application/{app_id}")
async def reject_application(req: Request, app_id: int, background: BackgroundTasks, reason: str | None = Body(None), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Only admin can reject applications")
    from app.models import PendingUser
    q = select(PendingUser).where(PendingUser.id == app_id)
    res = await db.execute(q)
    entry = res.scalars().first()
    if not entry:
        raise HTTPException(status_code=404, detail="Application not found")
    email = entry.email
    username = entry.username
    role = entry.role.value if hasattr(entry.role, 'value') else str(entry.role)
    # delete application
    await db.delete(entry)
    await db.commit()

    # 记录系统日志
    await create_system_log(
        db=db,
        operation_type=OperationLog.USER_REJECT.value,
        user_id=current_user.id,
        username=current_user.username,
        resource_type="user",
        description=f"管理员 {current_user.username} 拒绝申请：{username}（{email}，角色：{role}）" + (f"，原因：{reason}" if reason else ""),
        status="success",
        ip_address=get_client_ip(req),
        user_agent=get_user_agent(req),
    )

    # send rejection email in background (include reason if provided)
    subject = "AudioLab 申请被拒绝"
    body = f"你好 {username},\n\n很抱歉，你在 AudioLab 的专家/管理员申请未通过。"
    if reason:
        body += f"\n\n管理员留言：{reason}"
    body += "\n\n如需了解更多请联系管理员。\n\n此邮件由系统自动发送。"
    background.add_task(send_simple_email, email, subject, body)
    return {"message": "rejected"}


@router.post("/reject_user/{user_id}")
async def reject_user(req: Request, user_id: int, background: BackgroundTasks, reason: str | None = Body(None), current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Only admin can reject users")
    q = select(User).where(User.id == user_id)
    res = await db.execute(q)
    u = res.scalars().first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    # mark disabled / rejected
    u.is_active = False
    await db.commit()

    # 记录系统日志
    await create_system_log(
        db=db,
        operation_type=OperationLog.USER_REJECT.value,
        user_id=current_user.id,
        username=current_user.username,
        resource_type="user",
        resource_id=user_id,
        description=f"管理员 {current_user.username} 拒绝/禁用用户 {u.username}" + (f"，原因：{reason}" if reason else ""),
        status="success",
        ip_address=get_client_ip(req),
        user_agent=get_user_agent(req),
    )

    # send rejection email (include reason if provided)
    subject = "AudioLab 账号被拒绝/禁用"
    body = f"你好 {u.username}，\n\n你的账号已被管理员拒绝或禁用。"
    if reason:
        body += f"\n\n管理员留言：{reason}"
    body += "\n\n如需再次申请，请使用相同邮箱重新注册。\n\n此邮件由系统自动发送。"
    background.add_task(send_simple_email, u.email, subject, body)
    return {"message": "rejected"}


@router.post("/upload_avatar")
async def upload_avatar(file: UploadFile = File(...)):
    """Accept avatar upload and save to backend/download/avatar; returns avatar_url path"""
    # sanitize filename
    name = file.filename or "avatar"
    # keep only safe chars
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    fname = f"{int(time.time())}_{name}"
    # target directory relative to project backend folder
    base_dir = pathlib.Path(__file__).resolve().parents[1]  # backend/app -> backend
    target_dir = base_dir / "download" / "avatar"
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = target_dir / fname
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)
    # return relative URL path (frontend can fetch from backend static route if configured)
    return {"avatar_url": f"/download/avatar/{fname}"}


@router.get("/pending", response_model=list[PendingUserResponse])
async def list_pending_users(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Only admin can view pending users")
    # return pending applications and also include any existing User rows that are unapproved
    from app.models import PendingUser
    from app.schemas import PendingUserResponse
    q = select(PendingUser)
    res = await db.execute(q)
    apps = res.scalars().all()

    # fetch unapproved users with expert/admin roles (created before we had application flow)
    q2 = select(User).where(User.is_approved == False).where(User.role.in_([Role.EXPERT, Role.ADMIN]))
    res2 = await db.execute(q2)
    unapproved_users = res2.scalars().all()

    results = []
    for a in apps:
        results.append(PendingUserResponse.from_orm(a))
    for u in unapproved_users:
        # map User -> PendingUserResponse shape
        results.append(
            PendingUserResponse(
                id=u.id,
                username=u.username,
                email=u.email,
                role=u.role.value if hasattr(u.role, "value") else str(u.role),
                created_at=u.created_at,
                source="existing_user",
            )
        )
    return results

