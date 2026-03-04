# SMTP 邮件配置指南

## 当前状态

如果看到以下日志，说明系统处于**邮件模拟模式**（mock mode），验证码不会真正发送：

```
[EMAIL MOCK] to=xxx@example.com code=123456 reason=SMTP_HOST/SMTP_USER not configured
[VERIFICATION CODE] 验证码已发送到 xxx@example.com
```

## 配置步骤

### 1. 设置环境变量

在 Windows PowerShell 中，设置以下环境变量：

```powershell
# QQ 邮箱示例
$env:SMTP_HOST = "smtp.qq.com"
$env:SMTP_PORT = "587"  # 或 "465"
$env:SMTP_USER = "your_email@qq.com"
$env:SMTP_PASS = "your_authorization_code"  # QQ 邮箱需要使用授权码，不是登录密码
$env:EMAIL_DELIVERY_MODE = "smtp"  # 必须设置为 "smtp" 才能真实发送

# Gmail 示例
$env:SMTP_HOST = "smtp.gmail.com"
$env:SMTP_PORT = "587"
$env:SMTP_USER = "your_email@gmail.com"
$env:SMTP_PASS = "your_app_password"  # Gmail 需要使用应用专用密码
$env:EMAIL_DELIVERY_MODE = "smtp"
```

### 2. 创建 .env 文件（推荐）

在 `backend/` 目录下创建 `.env` 文件，添加以下内容：

```env
# SMTP 邮件配置
SMTP_HOST=smtp.qq.com
SMTP_PORT=587
SMTP_USER=your_email@qq.com
SMTP_PASS=your_authorization_code
EMAIL_DELIVERY_MODE=smtp
MAIL_FROM=your_email@qq.com  # 可选，默认使用 SMTP_USER
```

**注意**：`.env` 文件通常不应提交到 Git，确保已添加到 `.gitignore`。

### 3. 常见邮箱 SMTP 配置

#### QQ 邮箱

- **SMTP 服务器**：`smtp.qq.com`
- **端口**：`587`（推荐）或 `465`
- **安全连接**：TLS/SSL
- **授权码获取**：
  1. 登录 QQ 邮箱网页版
  2. 设置 → 账户
  3. 开启 "POP3/SMTP服务" 或 "IMAP/SMTP服务"
  4. 生成授权码（16位字符）

#### Gmail

- **SMTP 服务器**：`smtp.gmail.com`
- **端口**：`587`（推荐）或 `465`
- **安全连接**：TLS/SSL
- **应用专用密码**：
  1. 登录 Google 账户
  2. 安全性 → 两步验证 → 应用专用密码
  3. 生成新的应用专用密码

#### 163 邮箱

- **SMTP 服务器**：`smtp.163.com`
- **端口**：`465` 或 `25`
- **安全连接**：SSL
- **授权码获取**：设置 → POP3/SMTP/IMAP → 开启服务并获取授权码

#### 企业邮箱

- 联系企业 IT 管理员获取 SMTP 配置信息
- 通常需要企业邮箱账号和密码

### 4. 验证配置

配置完成后，重启后端服务，然后：

1. **查看日志**：发送验证码时应该看到：
   ```
   [EMAIL SEND] 开始发送验证码邮件 to=xxx@example.com host=smtp.qq.com port=587 user=xxx@qq.com
   [EMAIL SEND OK] 邮件发送成功 to=xxx@example.com mode=starttls host=smtp.qq.com port=587
   [VERIFICATION CODE] 验证码已发送到 xxx@example.com
   ```

2. **测试邮件发送**（管理员功能）：
   - 登录管理员账号
   - 访问 `/api/auth/test_email` 接口
   - 发送测试邮件验证配置是否正确

### 5. 故障排查

#### 问题：仍然显示 `[EMAIL MOCK]`

**原因**：
- 环境变量未正确设置
- `EMAIL_DELIVERY_MODE` 仍为 `"mock"`

**解决**：
- 检查环境变量是否正确设置：`echo $env:SMTP_HOST`（PowerShell）
- 确保 `EMAIL_DELIVERY_MODE=smtp`
- 重启后端服务

#### 问题：`SMTP认证失败`

**原因**：
- 密码/授权码错误
- 未使用授权码（QQ/Gmail 需要使用授权码，不是登录密码）

**解决**：
- 确认使用的是授权码/应用专用密码，不是登录密码
- 重新生成授权码并更新配置

#### 问题：`SMTP连接失败`

**原因**：
- 网络问题
- 防火墙阻止
- SMTP 服务器地址或端口错误

**解决**：
- 检查网络连接
- 确认 SMTP 服务器地址和端口正确
- 检查防火墙设置

#### 问题：邮件发送成功但收不到

**原因**：
- 邮件被标记为垃圾邮件
- 邮箱地址错误

**解决**：
- 检查垃圾邮件文件夹
- 确认收件人邮箱地址正确
- 检查发件人邮箱是否被收件方屏蔽

## 代码位置

邮件发送相关代码位于：
- `backend/app/routers/auth.py` - `send_email_code_sync()` 函数（第 101-198 行）
- `backend/app/routers/auth.py` - `send_simple_email()` 函数（第 201-250 行）

## 系统配置（数据库）

系统还支持通过数据库配置 SMTP 参数（通过系统设置页面），但当前代码优先使用环境变量。如需使用数据库配置，需要修改代码以从数据库读取配置。
