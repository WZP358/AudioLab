"""
创建初始账号（Docker 首次启动后执行）
运行方式: python -m app.create_admin

说明：
- 本脚本会"创建或更新"两类账号：expert / admin
- 设计目标：一键把系统跑通（专家评分、管理员后台）
"""
import asyncio
from passlib.context import CryptContext
from app.database import AsyncSessionLocal, engine
from app.models import User, Role
from app.utils import generate_id

# 使用与 auth.py 相同的密码上下文（仅 pbkdf2_sha256）
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


DEFAULT_USERS = [
    # admin：可进入后台
    {
        "username": "admin",
        "email": "wzp123456789@2925.com",
        "password": "admin123",
        "role": Role.ADMIN,
        "is_active": 1,
        "is_approved": 1,
    },
    # expert：可提交评分（后端限制：仅专家可 POST /api/scores）
    {
        "username": "wzp",
        "email": "3581447810@qq.com",
        "password": "expert123",
        "role": Role.EXPERT,
        "is_active": 1,
        "is_approved": 1,
    },
]


async def create_admin():
    """
    创建/更新默认账号（admin / expert）
    并在结束前显式关闭连接池，避免 aiomysql 在事件循环关闭后再清理连接
    导致的 "Event loop is closed" 警告。
    """
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import text
            from sqlalchemy.exc import IntegrityError

            created = 0
            updated = 0
            errors = []

            for u in DEFAULT_USERS:
                try:
                    password_hash = pwd_context.hash(u["password"])
                    role_name = u["role"].name  # DB enum 存储的是枚举 name（如 ADMIN/EXPERT/GUEST）

                    # 优先检查 (email, role) 组合（与 uq_user_email_role 一致）
                    check_by_email_role = await db.execute(
                        text(
                            "SELECT id, username FROM users WHERE email = :email AND role = :role LIMIT 1"
                        ),
                        {"email": u["email"], "role": role_name},
                    )
                    existing_by_email_role = check_by_email_role.first()

                    # 如果 (email, role) 不存在，再检查 username
                    # 注意：MySQL 的唯一约束是大小写不敏感的，所以需要同时检查大小写敏感和大小写不敏感的情况
                    existing_by_username = None
                    existing_by_username_case_insensitive = None
                    
                    if not existing_by_email_role:
                        # 1. 先检查大小写敏感匹配（精确匹配）
                        check_by_username = await db.execute(
                            text(
                                "SELECT id, email, role FROM users WHERE BINARY username = :username LIMIT 1"
                            ),
                            {"username": u["username"]},
                        )
                        existing_by_username = check_by_username.first()
                        
                        # 2. 如果大小写敏感没找到，检查大小写不敏感匹配
                        # 这可以找到数据库中已存在但大小写不同的记录（如 "wzp" vs "WZP"）
                        if not existing_by_username:
                            check_by_username_ci = await db.execute(
                                text(
                                    "SELECT id, email, role, username FROM users WHERE username = :username LIMIT 1"
                                ),
                                {"username": u["username"]},
                            )
                            result_ci = check_by_username_ci.first()
                            # 只有当找到的记录但大小写不同时，才认为是大小写不敏感匹配
                            if result_ci and result_ci[3] != u["username"]:
                                existing_by_username_case_insensitive = result_ci

                    if existing_by_email_role:
                        # 找到匹配的 (email, role)，更新该记录
                        # 注意：如果 username 需要更改，需要先检查新 username 是否已被占用
                        old_username = existing_by_email_role[1]
                        if old_username != u["username"]:
                            # 检查新 username 是否已被其他记录占用（使用 BINARY 强制大小写敏感）
                            check_username_conflict = await db.execute(
                                text(
                                    "SELECT id FROM users WHERE BINARY username = :username AND id != :id LIMIT 1"
                                ),
                                {"username": u["username"], "id": existing_by_email_role[0]},
                            )
                            if check_username_conflict.first():
                                errors.append(f"❌ {u['username']} ({role_name}): username 已被其他账号占用")
                                continue

                        await db.execute(
                            text(
                                """
                                UPDATE users
                                SET username = :username,
                                    password_hash = :password_hash,
                                    is_active = :is_active,
                                    is_approved = :is_approved
                                WHERE id = :id
                                """
                            ),
                            {
                                "id": existing_by_email_role[0],
                                "username": u["username"],
                                "password_hash": password_hash,
                                "is_active": u["is_active"],
                                "is_approved": u["is_approved"],
                            },
                        )
                        await db.commit()
                        updated += 1
                        print(f"✓ 默认账号已更新：{u['username']} ({role_name})")
                    elif existing_by_username:
                        # 找到匹配的 username，但 email 或 role 不同，更新该记录
                        # 注意：需要先检查新的 (email, role) 组合是否已被占用
                        old_email = existing_by_username[1]
                        old_role = existing_by_username[2]
                        if old_email != u["email"] or old_role != role_name:
                            check_email_role_conflict = await db.execute(
                                text(
                                    "SELECT id FROM users WHERE email = :email AND role = :role AND id != :id LIMIT 1"
                                ),
                                {"email": u["email"], "role": role_name, "id": existing_by_username[0]},
                            )
                            if check_email_role_conflict.first():
                                errors.append(f"❌ {u['username']} ({role_name}): (email, role) 组合已被其他账号占用")
                                continue

                        await db.execute(
                            text(
                                """
                                UPDATE users
                                SET email = :email,
                                    password_hash = :password_hash,
                                    role = :role,
                                    is_active = :is_active,
                                    is_approved = :is_approved
                                WHERE id = :id
                                """
                            ),
                            {
                                "id": existing_by_username[0],
                                "email": u["email"],
                                "password_hash": password_hash,
                                "role": role_name,
                                "is_active": u["is_active"],
                                "is_approved": u["is_approved"],
                            },
                        )
                        await db.commit()
                        updated += 1
                        print(f"✓ 默认账号已更新：{u['username']} ({role_name})")
                    elif existing_by_username_case_insensitive:
                        # 找到大小写不敏感匹配的 username（如数据库中已有 "wzp"，我们要创建 "WZP"）
                        # 这说明数据库的 username 字段 collation 仍然是大小写不敏感的
                        # 需要修改数据库表结构，将 username 字段改为 utf8mb4_bin collation 以支持大小写敏感
                        old_username = existing_by_username_case_insensitive[3]
                        errors.append(f"❌ {u['username']} ({role_name}): username 与已存在的账号 '{old_username}' 冲突。请先运行 'python -m app.init_db' 修改 username 字段为大小写敏感（utf8mb4_bin collation），然后重新运行此脚本。")
                        continue
                    else:
                        # 都不存在，创建新记录
                        uid = generate_id()
                        await db.execute(
                            text(
                                """
                                INSERT INTO users (id, username, email, password_hash, role, is_active, is_approved)
                                VALUES (:id, :username, :email, :password_hash, :role, :is_active, :is_approved)
                                """
                            ),
                            {
                                "id": uid,
                                "username": u["username"],
                                "email": u["email"],
                                "password_hash": password_hash,
                                "role": role_name,
                                "is_active": u["is_active"],
                                "is_approved": u["is_approved"],
                            },
                        )
                        await db.commit()
                        created += 1
                        print(f"+ 默认账号已创建：{u['username']} ({role_name})")
                except IntegrityError as e:
                    await db.rollback()
                    error_msg = str(e)
                    if "uq_user_email_role" in error_msg:
                        errors.append(f"❌ {u['username']} ({role_name}): (email, role) 组合已存在")
                    elif "username" in error_msg.lower():
                        errors.append(f"❌ {u['username']} ({role_name}): username 已存在")
                    else:
                        errors.append(f"❌ {u['username']} ({role_name}): {error_msg}")
                except Exception as e:
                    await db.rollback()
                    errors.append(f"❌ {u['username']} ({role_name}): {str(e)}")

            if errors:
                print("\n⚠️  以下账号处理失败：")
                for error in errors:
                    print(f"  {error}")

            print("\n================ 默认账号（开发/演示用） ================")
            for u in DEFAULT_USERS:
                print(f"- username: {u['username']}\n  email: {u['email']}\n  password: {u['password']}\n  role: {u['role'].name}\n")
            print("⚠️  生产环境请务必修改默认密码 / 替换默认账号！")
    finally:
        # 显式关闭 AsyncEngine 内部的连接池和所有连接，防止 __del__ 在 loop 关闭后再调度任务
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(create_admin())
