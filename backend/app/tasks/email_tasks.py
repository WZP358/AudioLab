from celery import Celery
import warnings
# Suppress non-critical warnings early to keep worker logs clean
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")
warnings.filterwarnings("ignore", category=PendingDeprecationWarning)

import os
import smtplib
import ssl
from email.message import EmailMessage
from sqlalchemy import create_engine, text
from prometheus_client import Counter, Gauge
import requests
import json

VERIFICATION_TTL_MIN = int(os.getenv("VERIFICATION_TTL_MIN", "15"))

# Broker / backend defaults (docker-compose uses redis service)
CELERY_BROKER = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
CELERY_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/0")

celery = Celery("audio_tasks", broker=CELERY_BROKER, backend=CELERY_BACKEND)

# Prometheus metrics
EMAIL_OUTBOX_SENT = Counter("audiolab_email_outbox_sent_total", "Total outbox emails sent")
EMAIL_OUTBOX_FAILED = Counter("audiolab_email_outbox_failed_total", "Total outbox emails failed")
EMAIL_OUTBOX_ATTEMPTS = Counter("audiolab_email_outbox_attempts_total", "Total outbox send attempts")
EMAIL_OUTBOX_PENDING = Gauge("audiolab_email_outbox_pending", "Current pending outbox emails")

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


@celery.task(bind=True, max_retries=3, default_retry_delay=5)
def send_verification_email(self, email: str, code: str):
    """Send verification email with retries. Runs in worker process."""
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "465"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    subject = "Your AudioLab verification code"
    body = f"Your verification code is: {code}\nThis code expires in {VERIFICATION_TTL_MIN} minutes."

    if not (smtp_host and smtp_user):
        # 严格模式：不再回退到 MOCK，而是直接报错
        raise RuntimeError("SMTP not configured: please set SMTP_HOST and SMTP_USER")
    if not smtp_pass:
        raise RuntimeError("SMTP not configured: please set SMTP_PASS (most SMTP servers require authentication)")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = os.getenv("MAIL_FROM") or smtp_user
    msg["To"] = email
    msg.set_content(body)

    # Try provider API (SendGrid) if configured, then fallback to SMTP sequence.
    sendgrid_key = os.getenv("SENDGRID_API_KEY")
    if sendgrid_key:
        try:
            payload = {
                "personalizations": [{"to": [{"email": email}], "subject": subject}],
                "from": {"email": os.getenv("MAIL_FROM") or smtp_user},
                "content": [{"type": "text/plain", "value": body}],
            }
            headers = {"Authorization": f"Bearer {sendgrid_key}", "Content-Type": "application/json"}
            resp = requests.post("https://api.sendgrid.com/v3/mail/send", headers=headers, json=payload, timeout=15)
            if 200 <= resp.status_code < 300:
                # mark in DB that this verification was sent (idempotent)
                try:
                    db_url = os.getenv("DATABASE_URL", "mysql+aiomysql://audiolab:wzp@db:3306/audiolab")
                    sync_db_url = db_url.replace("mysql+aiomysql", "mysql+pymysql")
                    engine = create_engine(sync_db_url)
                    with engine.begin() as conn:
                        conn.execute(text("UPDATE email_verifications SET sent=1 WHERE email=:email AND code=:code"), {"email": email, "code": code})
                except Exception:
                    print("failed to mark verification sent in DB after provider send")
                EMAIL_OUTBOX_SENT.inc()
                return {"status": "sent", "provider": "sendgrid"}
            else:
                _log_warn(f"[EMAIL SEND WARN provider=sendgrid] status={resp.status_code} body={resp.text}")
        except Exception as exc:
            _log_warn(f"[EMAIL SEND WARN provider=sendgrid] error={exc}")

    # attempt sequence via SMTP
    modes = []
    if smtp_port == 465:
        modes = [("ssl", smtp_host, smtp_port)]
    else:
        modes = [("starttls", smtp_host, smtp_port), ("ssl", smtp_host, 465)]

    last_err = None
    attempts = 0
    for mode, host, port in modes:
        try:
            if mode == "ssl":
                with smtplib.SMTP_SSL(host, port, timeout=20) as s:
                    s.ehlo()
                    s.login(smtp_user, smtp_pass)
                    s.send_message(msg)
            else:
                with smtplib.SMTP(host, port, timeout=20) as s:
                    s.ehlo()
                    s.starttls(context=ssl.create_default_context())
                    s.ehlo()
                    s.login(smtp_user, smtp_pass)
                    s.send_message(msg)
            # mark in DB that this verification was sent (idempotent)
            try:
                db_url = os.getenv("DATABASE_URL", "mysql+aiomysql://audiolab:wzp@db:3306/audiolab")
                sync_db_url = db_url.replace("mysql+aiomysql", "mysql+pymysql")
                engine = create_engine(sync_db_url)
                with engine.begin() as conn:
                    conn.execute(text("UPDATE email_verifications SET sent=1 WHERE email=:email AND code=:code"), {"email": email, "code": code})
            except Exception as _:
                print("failed to mark verification sent in DB")
            EMAIL_OUTBOX_SENT.inc()
            return {"status": "sent", "mode": mode}
        except Exception as exc:
            last_err = exc
            attempts += 1
            _log_warn(f"[EMAIL SEND WARNING] attempt={attempts} mode={mode} host={host} port={port} error={exc}")
            try:
                raise self.retry(exc=exc)
            except Exception:
                # continue to next mode or finish
                continue

    _log_warn(f"[EMAIL SEND ERROR] all attempts failed error={last_err}")
    raise last_err


@celery.task(bind=True, max_retries=5, default_retry_delay=10)
def send_outbox(self, outbox_id: int):
    """Process an OutboxEmail row by id, send message and update DB row/status."""
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "465"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    if not (smtp_host and smtp_user):
        raise RuntimeError("SMTP not configured: please set SMTP_HOST and SMTP_USER")
    if not smtp_pass and not os.getenv("SENDGRID_API_KEY"):
        raise RuntimeError("SMTP not configured: please set SMTP_PASS (or configure SENDGRID_API_KEY)")

    # fetch outbox row using sync engine
    db_url = os.getenv("DATABASE_URL", "mysql+aiomysql://audiolab:wzp@db:3306/audiolab")
    sync_db_url = db_url.replace("mysql+aiomysql", "mysql+pymysql")
    engine = create_engine(sync_db_url)

    with engine.begin() as conn:
        row = conn.execute(text("SELECT id, to_email, subject, body, status, attempts FROM outbox_emails WHERE id = :id FOR UPDATE"), {"id": outbox_id}).mappings().first()
        if not row:
            print("outbox row not found", outbox_id)
            return {"status": "missing"}
        if row["status"] == "sent":
            print("outbox already sent", outbox_id)
            return {"status": "already_sent"}
        to_email = row["to_email"]
        subject = row["subject"]
        body = row["body"]
        attempts = row["attempts"] or 0

        # prepare message
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = os.getenv("MAIL_FROM") or smtp_user
        msg["To"] = to_email
        msg.set_content(body)

        # attempt send
        modes = []
        if smtp_port == 465:
            modes = [("ssl", smtp_host, smtp_port)]
        else:
            modes = [("starttls", smtp_host, smtp_port), ("ssl", smtp_host, 465)]

        last_err = None
        # Try provider API first (SendGrid) if configured
        sendgrid_key = os.getenv("SENDGRID_API_KEY")
        if sendgrid_key:
            try:
                payload = {
                    "personalizations": [{"to": [{"email": to_email}], "subject": subject}],
                    "from": {"email": os.getenv("MAIL_FROM") or smtp_user},
                    "content": [{"type": "text/plain", "value": body}],
                }
                headers = {"Authorization": f"Bearer {sendgrid_key}", "Content-Type": "application/json"}
                resp = requests.post("https://api.sendgrid.com/v3/mail/send", headers=headers, json=payload, timeout=15)
                if 200 <= resp.status_code < 300:
                    with engine.begin() as conn:
                        conn.execute(text("UPDATE outbox_emails SET status='sent', attempts=attempts+1, sent_at=now(), last_error=NULL WHERE id = :id"), {"id": outbox_id})
                        try:
                            conn.execute(text("UPDATE email_verifications SET sent=1 WHERE email = :email"), {"email": to_email})
                        except Exception:
                            pass
                    print(f"[OUTBOX SEND OK provider=sendgrid] id={outbox_id} to={to_email} status={resp.status_code}")
                    EMAIL_OUTBOX_SENT.inc()
                    return {"status": "sent", "provider": "sendgrid"}
                else:
                    _log_warn(f"[OUTBOX SEND WARN provider=sendgrid] id={outbox_id} status={resp.status_code} body={resp.text}")
            except Exception as exc:
                last_err = exc
                _log_warn(f"[OUTBOX SEND WARN provider=sendgrid] id={outbox_id} error={exc}")

        # SMTP fallback sequence
        last_err = None
        attempts = attempts or 0
        for mode, host, port in modes:
            try:
                if mode == "ssl":
                    with smtplib.SMTP_SSL(host, port, timeout=20) as s:
                        s.ehlo()
                        s.login(smtp_user, smtp_pass)
                        s.send_message(msg)
                else:
                    with smtplib.SMTP(host, port, timeout=20) as s:
                        s.ehlo()
                        s.starttls(context=ssl.create_default_context())
                        s.ehlo()
                        s.login(smtp_user, smtp_pass)
                        s.send_message(msg)
                # on success update outbox and mark related verification sent
                with engine.begin() as conn:
                    conn.execute(text("UPDATE outbox_emails SET status='sent', attempts=attempts+1, sent_at=now(), last_error=NULL WHERE id = :id"), {"id": outbox_id})
                    try:
                        conn.execute(text("UPDATE email_verifications SET sent=1 WHERE email = :email"), {"email": to_email})
                    except Exception:
                        pass
                EMAIL_OUTBOX_SENT.inc()
                return {"status": "sent", "mode": mode}
            except Exception as exc:
                last_err = exc
                attempts += 1
                EMAIL_OUTBOX_ATTEMPTS.inc()
                _log_warn(f"[OUTBOX SEND WARNING] id={outbox_id} attempt={attempts} mode={mode} error={exc}")
                # update attempts count and last_error
                try:
                    with engine.begin() as conn:
                        conn.execute(text("UPDATE outbox_emails SET attempts = :attempts, last_error = :err WHERE id = :id"), {"attempts": attempts, "err": str(exc), "id": outbox_id})
                except Exception:
                    pass
                # retry via Celery
                try:
                    raise self.retry(exc=exc)
                except Exception:
                    continue

        # all modes failed: mark outbox as failed before raising
        try:
            with engine.begin() as conn:
                conn.execute(text("UPDATE outbox_emails SET status='failed', attempts=:attempts, last_error=:err WHERE id = :id"), {"attempts": attempts, "err": str(last_err), "id": outbox_id})
        except Exception:
            print("failed to mark outbox as failed in DB")
        _log_warn(f"[OUTBOX SEND ERROR] all attempts failed id={outbox_id} error={last_err}")
        raise last_err

