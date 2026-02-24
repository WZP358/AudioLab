## 目录

- **1. 你将得到什么（产品故事版）**
- **2. 架构总览（含 Mermaid 图）**
- **3. 从零到跑起来（本地部署）**
- **4. 第一次启动后你要做的三件事（init_db / init_system_configs / create_admin）**
- **5. 作为用户使用系统（访客/专家）**
- **6. 作为管理员管理系统**
- **7. 配置（环境变量 + SystemConfig）**
- **8. API 速查表**
- **9. 故障排查（FAQ）**
- **10. 已知限制（按当前代码）**

---

## 1. 你将得到什么（产品故事版）

想像你和团队在做"音乐源分离"算法评估：  
你需要的不只是"跑个模型"，而是一个**有秩序的评估现场**：

- 现场要有"观众"（访客）能试玩、能看公共资源
- 现场要有"评委"（专家）能对分离结果按 stem 打分
- 现场要有"导演"（管理员）能审批账号、管理资源、看系统日志、发系统通知

AudioLab 就是把这个现场搭起来：

- **普通用户端（访客/专家）**
  - 上传音频 → 选择算法 → 创建分离任务（后台处理）
  - 任务完成后：播放原音与 stems，对比波形/频谱
  - 专家可以提交评分；所有人可以看社区统计与公开音频资源
- **管理员后台**
  - 审批专家/管理员注册申请
  - 管理音频资源（上传/更新/删除/重新分析时长）
  - 系统管理：系统日志、系统设置、通知中心、数据统计

### 1.1 系统功能概览

```mermaid
mindmap
  root((AudioLab))
    用户端
      上传音频
      选择算法
      查看分离结果
      播放对比
      提交评分
      查看统计
    管理员端
      用户管理
      审批申请
      资源管理
      系统设置
      日志查看
      数据分析
    核心功能
      音频分离
      算法评估
      社区评分
      资源分享
```

### 1.2 系统界面预览

![系统主界面](docs/images/01-main-dashboard.png)
*图 1.1：AudioLab 主界面 - 音频上传与分离任务管理*

![分离结果展示](docs/images/02-separation-results.png)
*图 1.2：分离结果展示 - 可播放各个声源（Vocals、Drums、Bass、Other）并查看波形对比*

![管理员后台](docs/images/03-admin-dashboard.png)
*图 1.3：管理员后台 - 用户管理、音频资源管理、系统设置*

![评分统计](docs/images/04-scoring-stats.png)
*图 1.4：评分统计页面 - 算法对比与社区评分数据*

---

## 2. 架构总览（含 Mermaid 图）

### 2.1 组件关系：前端 / 后端 / 数据库 / 文件存储

```mermaid
flowchart LR
  U["用户浏览器<br/>React 前端"] -->|HTTP| API["FastAPI 后端<br/>:8000"]
  API -->|Async SQLAlchemy| DB[("MySQL 8")]
  API -->|读写| UP["/uploads<br/>上传原始音频/"]
  API -->|读写| RS["/results<br/>分离结果 stems/"]
  API -->|读写| AR["/audio_resources<br/>公共资源文件/"]
  API -->|静态挂载| DL["/download/avatar<br/>头像静态文件/"]
```

![系统架构图](docs/images/05-system-architecture.png)
*图 2.1：AudioLab 系统架构 - 展示前端、后端、数据库和文件存储的关系*

### 2.2 数据流转图

```mermaid
flowchart TD
    A[用户上传音频] --> B[FastAPI 接收]
    B --> C[保存到 /uploads]
    B --> D[创建 SeparationTask]
    D --> E[异步处理任务]
    E --> F{MSS 引擎}
    F -->|调用| G[inference.py]
    G --> H[生成分离结果]
    H --> I[保存到 /results]
    I --> J[更新任务状态]
    J --> K[前端轮询获取结果]
    K --> L[展示分离音频]
```

![数据流转图](docs/images/06-data-flow.png)
*图 2.2：音频分离任务的数据流转过程*

### 2.3 用户角色权限图

```mermaid
flowchart TD
    A[用户] --> B{角色类型}
    B -->|Guest| C[访客权限<br/>- 上传音频<br/>- 查看公共资源<br/>- 查看统计]
    B -->|Expert| D[专家权限<br/>- 访客所有权限<br/>- 提交评分<br/>- 查看详细统计]
    B -->|Admin| E[管理员权限<br/>- 专家所有权限<br/>- 审批用户<br/>- 管理资源<br/>- 系统设置]
```

![用户角色权限](docs/images/07-user-roles.png)
*图 2.3：不同用户角色的权限划分*

### 2.4 数据库表关系图

```mermaid
erDiagram
    User ||--o{ SeparationTask : creates
    User ||--o{ Score : submits
    User ||--o{ AudioResource : uploads
    User ||--o{ PendingUser : applies
    SeparationTask ||--o{ StemFile : generates
    SeparationTask ||--o{ Score : evaluated_by
    SystemConfig }o--|| User : managed_by
    
    User {
        bigint id PK
        string username
        string email
        string role
        boolean is_approved
    }
    
    SeparationTask {
        bigint id PK
        bigint user_id FK
        string algorithm
        string status
        datetime created_at
    }
    
    StemFile {
        bigint id PK
        bigint task_id FK
        string stem_name
        string file_path
    }
    
    Score {
        bigint id PK
        bigint task_id FK
        bigint user_id FK
        float quality
        float interference
        float artifacts
    }
    
    AudioResource {
        bigint id PK
        bigint uploader_id FK
        string title
        string category
        boolean is_public
    }
    
    SystemConfig {
        string key PK
        string value
        string description
    }
```

### 2.5 API 路由结构图

```mermaid
graph TB
    API[FastAPI 后端] --> Auth[/api/auth]
    API --> Tasks[/api/tasks]
    API --> Scores[/api/scores]
    API --> Audio[/api/audio]
    API --> Admin[/api/admin]
    API --> System[/api/admin/system]
    
    Auth --> Register[POST /register]
    Auth --> Login[POST /login]
    Auth --> Pending[GET /pending]
    Auth --> Approve[POST /approve_application]
    
    Tasks --> Upload[POST /upload]
    Tasks --> GetTask[GET /{task_id}]
    Tasks --> GetStems[GET /{task_id}/stems]
    Tasks --> Download[GET /{task_id}/stems/{stem_id}/download]
    
    Scores --> Submit[POST /]
    Scores --> Stats[GET /stats]
    Scores --> Comparison[GET /stats/algorithm-comparison]
    
    Audio --> Resources[GET /resources]
    Audio --> UploadResource[POST /resources/upload]
    
    Admin --> Users[/users]
    Admin --> AudioAdmin[/audio]
    
    System --> Logs[/logs]
    System --> Configs[/configs]
    System --> Notifications[/notifications]
    System --> Analytics[/analytics]
```

---

## 3. 从零到跑起来（本地部署）

### 3.1 准备 MSS 模型文件（可选，但推荐）

如果你要使用 MSS 源分离算法（MDX23C、Demucs4HT、Band Split RoFormer、SCNet），需要先下载模型权重文件：

#### 3.2.1 创建模型目录

首先创建模型存储目录（Windows 示例）：
```bash
mkdir D:\code\models\mss
```

#### 3.2.2 下载模型权重文件

将以下模型文件下载到 `D:\code\models\mss\` 目录：

| 算法 | 文件名 | 下载链接 |
|------|--------|----------|
| **MDX23C** | `model_mdx23c_ep_168_sdr_7.0207.ckpt` | [GitHub Releases](https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.1/model_mdx23c_ep_168_sdr_7.0207.ckpt) |
| **Demucs4HT** | `955717e8-8726e21a.th` | [Facebook AI](https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th) |
| **Band Split RoFormer** | `model_bs_roformer_ep_17_sdr_9.6568.ckpt` | [GitHub Releases](https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.12/model_bs_roformer_ep_17_sdr_9.6568.ckpt) |
| **SCNet** | `scnet_checkpoint_musdb18.ckpt` | [GitHub Releases](https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v.1.0.6/scnet_checkpoint_musdb18.ckpt) |

**下载方式**（任选其一）：
- **方式一：直接下载**：点击上表中的链接，浏览器会自动下载，将文件移动到 `D:\code\models\mss\` 目录
- **方式二：使用 wget/curl**：
  ```bash
  # Windows PowerShell
  cd D:\code\models\mss
  Invoke-WebRequest -Uri "https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.1/model_mdx23c_ep_168_sdr_7.0207.ckpt" -OutFile "model_mdx23c_ep_168_sdr_7.0207.ckpt"
  Invoke-WebRequest -Uri "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th" -OutFile "955717e8-8726e21a.th"
  Invoke-WebRequest -Uri "https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.12/model_bs_roformer_ep_17_sdr_9.6568.ckpt" -OutFile "model_bs_roformer_ep_17_sdr_9.6568.ckpt"
  Invoke-WebRequest -Uri "https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v.1.0.6/scnet_checkpoint_musdb18.ckpt" -OutFile "scnet_checkpoint_musdb18.ckpt"
  ```

**注意**：
- 模型文件较大（每个约 100-500 MB），下载需要一些时间
- 如果下载速度慢，可以尝试使用代理或镜像源
- 更多模型选项请参考：[Music-Source-Separation-Training 预训练模型列表](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/docs/pretrained_models.md)

#### 3.1.3 验证模型文件

下载完成后，确保目录结构如下：

![模型文件目录结构](docs/images/09-model-files.png)
*图 3.2：模型文件目录结构示例 - 确保所有模型文件放在正确位置*

```
D:\code\models\mss\
├── model_mdx23c_ep_168_sdr_7.0207.ckpt
├── 955717e8-8726e21a.th
├── model_bs_roformer_ep_17_sdr_9.6568.ckpt
└── scnet_checkpoint_musdb18.ckpt
```

#### 3.1.4 配置模型路径（可选）

如果模型文件不在默认位置 `D:\code\models\mss\`，需要在后端运行环境中通过环境变量覆盖默认路径（见 **7.3 MSS 源分离引擎配置** 中的 `MSS_*_CKPT`）。

### 3.2 准备 MSS 代码仓库（必需）

AudioLab 使用 [ZFTurbo/Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training) 仓库来执行音频分离。

#### 3.2.1 克隆 MSS 仓库

在 AudioLab 根目录下克隆 MSS 仓库：

```bash
cd D:\code\AudioLab
git clone https://github.com/ZFTurbo/Music-Source-Separation-Training.git Music-Source-Separation-Training-main
```

**注意**：
- 这个目录**会被包含在 AudioLab 仓库中**（已从 `.gitignore` 中移除）
- 如果不想上传到 GitHub，可以通过环境变量 `MSS_ROOT_DIR` 指定其他路径

### 3.3 在 Windows 本地使用 GPU（可选，适合快速测试）

如果你希望在 Windows 主机（或 WSL2）上直接利用显卡做快速测试，而不是在容器内运行 GPU，项目提供了本地启动脚本和说明。

- 本地快速启动（Windows，推荐用于测试）：
  1. 进入 `backend` 目录：
     ```powershell
     cd backend
     ```
  2. 运行本地启动脚本（会创建 `.venv`、安装依赖并尝试安装带 CUDA 的 PyTorch，失败回退到 CPU）：
     ```powershell
     powershell -ExecutionPolicy Bypass -File .\run_local_gpu.ps1
     ```
  3. 脚本会把 `MSS_FORCE_CPU` 设为 `false`（本地优先使用 GPU），并以 `uvicorn` 启动服务（监听 `0.0.0.0:8000`）。

  - 挂载与路径（与 MSS/模型相关）在本地通过环境变量和本地目录配置即可，无需容器挂载。

- 注意：
  - 本地脚本尝试安装 PyTorch cu124 wheel（若与你的驱动/CUDA 版本不匹配，请手动安装合适的 PyTorch 版本）。
  - 如果你更倾向使用 `conda` 来管理 CUDA 版本，我可以把 `run_local_gpu.ps1` 改为支持 `conda` 环境。
 
### 3.4 在本地运行后端与初始化数据库（Windows / macOS / Linux）

本项目推荐直接在宿主机上运行后端，下面的步骤会指导你如何准备数据库、安装依赖并执行初始化脚本。

注意：后端默认使用 MySQL（通过 `DATABASE_URL` 环境变量连接）。你可以在本地安装 MySQL / MariaDB，或者使用外部数据库服务。

快速步骤（Windows PowerShell 示例）：

```powershell
# 1) 进入 backend 目录
cd backend

# 2) 创建并激活虚拟环境（Windows PowerShell）
python -m venv .\.venv
.\.venv\Scripts\Activate.ps1

# 3) 安装 Python 依赖
pip install -r requirements.txt

# 4) 在本地 MySQL 中创建数据库与用户（登录 mysql 客户端执行）
-- SQL 示例:
-- CREATE DATABASE audiolab CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- CREATE USER 'audiolab'@'localhost' IDENTIFIED BY 'audiolab';
-- GRANT ALL PRIVILEGES ON audiolab.* TO 'audiolab'@'localhost';
-- FLUSH PRIVILEGES;

# 5) 在 PowerShell 中设置临时环境变量（仅本次会话有效）
$env:DATABASE_URL = "mysql+aiomysql://audiolab:audiolab@127.0.0.1:3306/audiolab"

# 6) 初始化数据库表结构、系统配置与默认账号
python -m app.init_db
python -m app.init_system_configs
python -m app.create_admin

# 7) 启动后端（开发模式，带热重载）
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

macOS / Linux（bash / zsh）示例：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 在 mysql 客户端或 admin 工具中创建数据库与用户（参考上面 SQL）
export DATABASE_URL="mysql+aiomysql://audiolab:audiolab@127.0.0.1:3306/audiolab"

python -m app.init_db
python -m app.init_system_configs
python -m app.create_admin

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

要点与常见问题：
- 如果你没有本地 MySQL，可以先安装 MySQL/MariaDB，或使用云数据库服务。
- `DATABASE_URL` 必须使用 `mysql+aiomysql://user:pass@host:port/db` 格式，后端会从 `backend/.env` 或环境变量读取该值。
- 如果执行 `python -m app.init_db` 出现连接错误，先确认 MySQL 已启动并允许来自本机的连接，检查端口与用户权限。
- 初始化脚本会在完成后关闭数据库连接池，避免事件循环关闭时的警告。
- 若需要 GPU，本地可运行 `.\run_local_gpu.ps1`（Windows），脚本会尝试安装带 CUDA 的 PyTorch 并以 `uvicorn` 启动后端。

## 4. 第一次启动后你要做的三件事（强烈建议按顺序）

> 下面命令都在**backend 目录（已激活虚拟环境）**执行。

### 4.1 初始化数据库表结构

```bash
python -m app.init_db
```

![数据库初始化](docs/images/13-db-init.png)
*图 4.1：数据库初始化命令执行结果 - 显示表结构创建成功*

### 4.2 初始化系统设置（SystemConfig）

```bash
python -m app.init_system_configs
```

![系统设置初始化](docs/images/14-system-config-init.png)
*图 4.2：系统设置初始化 - 创建默认配置项*

### 4.3 创建/更新默认账号（一次创建 3 个：guest / expert / admin）

```bash
python -m app.create_admin
```

```mermaid
flowchart LR
    Start[执行 create_admin] --> CheckDB{数据库已初始化?}
    CheckDB -->|否| Error[先执行 init_db]
    CheckDB -->|是| CreateGuest[创建 Guest 账号]
    CreateGuest --> CreateExpert[创建 Expert 账号]
    CreateExpert --> CreateAdmin[创建 Admin 账号]
    CreateAdmin --> Success[三个账号创建成功]
    
    style Error fill:#f44336
    style Success fill:#4caf50
```

![创建默认账号](docs/images/15-create-admin.png)
*图 4.3：创建默认账号 - 显示三个账号（guest/expert/admin）创建成功*

当前脚本会创建/更新 3 个默认账号（以 `backend/app/create_admin.py` 为准）：

- **admin（管理员）**
  - username: `admin`
  - email: `wzp123456789@2925.com`
  - password: `admin123`
- **expert（专家，可提交评分）**
  - username: `wzp`
  - email: `3581447810@qq.com`
  - password: `expert123`
- **guest（访客/普通用户）**
  - username: `WZP`
  - email: `zpw5650@gmail.com`
  - password: `guest123`

---

## 5. 作为用户使用系统（访客/专家）

### 5.1 注册与登录（"你是谁决定你能做什么"）

```mermaid
sequenceDiagram
  participant U as 用户
  participant FE as 前端 AuthPage
  participant API as 后端 /api/auth
  participant DB as MySQL

  U->>FE: 输入邮箱/用户名/密码/角色
  FE->>API: POST /send_code
  API->>DB: 写 EmailVerification
  API-->>FE: 200（mock 时提示看后端日志）
  U->>FE: 填验证码，提交注册
  FE->>API: POST /register
  API->>DB: 校验验证码
  alt role=guest
    API->>DB: 创建 User(is_approved=true)
    API-->>FE: 注册成功
  else role=expert/admin
    API->>DB: 创建 PendingUser（待审核）
    API-->>FE: application_submitted
  end
```

![注册登录界面](docs/images/16-auth-page.png)
*图 5.1：注册/登录界面 - 支持邮箱验证码注册和登录*

登录：
- 前端输入框名为 email，但后端实现支持"邮箱或用户名二选一"登录
- 专家/管理员若未审批，会被拒绝登录并提示"待管理员审核"

```mermaid
sequenceDiagram
    participant U as 用户
    participant FE as 前端
    participant API as 后端 API
    participant DB as 数据库
    
    U->>FE: 输入邮箱/用户名和密码
    FE->>API: POST /api/auth/login
    API->>DB: 查询用户
    DB-->>API: 返回用户信息
    alt 用户存在且密码正确
        alt 角色为 expert/admin
            alt 已审批
                API->>API: 生成 JWT Token
                API-->>FE: 返回 Token 和用户信息
                FE-->>U: 登录成功，跳转主页
            else 未审批
                API-->>FE: 403 待管理员审核
                FE-->>U: 显示"待审核"提示
            end
        else 角色为 guest
            API->>API: 生成 JWT Token
            API-->>FE: 返回 Token 和用户信息
            FE-->>U: 登录成功
        end
    else 用户不存在或密码错误
        API-->>FE: 401 认证失败
        FE-->>U: 显示错误提示
    end
```

![登录流程](docs/images/17-login-flow.png)
*图 5.2：登录流程示意图 - 展示从输入到登录成功的完整过程*

---

### 5.2 上传音频并创建分离任务

**支持的算法**：
- **MDX23C**：基于 MDX 架构的源分离模型
- **Demucs4HT**：Demucs v4 的变体，支持高质量分离
- **Band Split RoFormer**：基于 Band Split 和 RoFormer 的分离模型
- **SCNet**：SCNet 源分离模型

![算法选择界面](docs/images/18-algorithm-selection.png)
*图 5.3：算法选择界面 - 用户可以选择不同的分离算法*

调用链（对用户来说就是：上传 → 等待 → 播放）：
- `POST /api/tasks/upload?algorithm=...`（multipart `file`，algorithm 可选：`MDX23C`、`Demucs4HT`、`Band Split RoFormer`、`SCNet`）
- `GET /api/tasks/{task_id}`（轮询状态）
- `GET /api/tasks/{task_id}/stems`
- `GET /api/tasks/{task_id}/stems/{stem_id}/download`（浏览器播放，支持 Range）
- `GET /api/tasks/{task_id}/analysis?target=Vocals&include_all_stems=true`（波形/频谱）

```mermaid
sequenceDiagram
    participant U as 用户
    participant FE as 前端
    participant API as 后端 API
    participant DB as 数据库
    participant MSS as MSS 引擎
    
    U->>FE: 选择音频文件和算法
    FE->>API: POST /api/tasks/upload
    API->>DB: 保存文件到 /uploads
    API->>DB: 创建 SeparationTask (status=pending)
    API-->>FE: 返回 task_id
    FE->>FE: 开始轮询任务状态
    
    loop 每 2 秒轮询一次
        FE->>API: GET /api/tasks/{task_id}
        API->>DB: 查询任务状态
        alt 任务进行中
            DB-->>API: status=processing
            API-->>FE: 返回状态
            FE-->>U: 显示处理进度
        else 任务完成
            DB-->>API: status=completed
            API-->>FE: 返回完成状态
            FE->>API: GET /api/tasks/{task_id}/stems
            API-->>FE: 返回 stems 列表
            FE-->>U: 显示分离结果
        else 任务失败
            DB-->>API: status=failed
            API-->>FE: 返回错误信息
            FE-->>U: 显示错误提示
        end
    end
    
    Note over API,MSS: 后台异步处理
    API->>MSS: 调用分离引擎
    MSS->>MSS: 执行音频分离
    MSS->>DB: 保存结果到 /results
    MSS->>DB: 更新任务状态为 completed
```

```mermaid
flowchart TD
    Start[用户选择文件] --> Validate{文件格式有效?}
    Validate -->|否| Error1[显示错误提示]
    Validate -->|是| SelectAlgo[选择算法]
    SelectAlgo --> Upload[上传文件]
    Upload --> CreateTask[创建任务]
    CreateTask --> Process[后台处理]
    Process --> CheckStatus{检查状态}
    CheckStatus -->|processing| Wait[等待处理]
    Wait --> CheckStatus
    CheckStatus -->|completed| ShowResults[显示分离结果]
    CheckStatus -->|failed| ShowError[显示错误]
    ShowResults --> Play[播放音频]
    
    style Error1 fill:#f44336
    style ShowError fill:#f44336
    style ShowResults fill:#4caf50
```

![上传音频界面](docs/images/19-upload-audio.png)
*图 5.4：上传音频界面 - 支持拖拽或点击选择音频文件*

![任务处理进度](docs/images/20-task-progress.png)
*图 5.5：任务处理进度 - 显示上传、处理、完成的各个阶段*

**注意**：
- MSS 算法在 CPU 模式下运行较慢，请耐心等待（通常需要几分钟到十几分钟，取决于音频长度）
- 如果系统配置了 GPU，MSS 算法会自动使用 GPU 加速

![分离结果展示](docs/images/21-separation-results.png)
*图 5.6：分离结果展示 - 显示 Vocals、Drums、Bass、Other 四个声源*

---

### 5.3 评分与统计

评分（**仅专家可提交**）：
- `POST /api/scores`

```mermaid
flowchart TD
    Expert[专家用户] --> CheckRole{角色检查}
    CheckRole -->|非 Expert| Deny[拒绝访问]
    CheckRole -->|Expert| SelectTask[选择任务]
    SelectTask --> Listen[试听分离结果]
    Listen --> Rate[评分]
    Rate --> Submit[提交评分]
    Submit --> Save[保存到数据库]
    Save --> Update[更新统计]
    Update --> Show[显示在统计页面]
    
    style Deny fill:#f44336
    style Save fill:#4caf50
```

```mermaid
sequenceDiagram
    participant E as 专家
    participant FE as 前端
    participant API as 后端
    participant DB as 数据库
    
    E->>FE: 选择任务并试听
    E->>FE: 填写评分表单<br/>quality/interference/artifacts
    FE->>API: POST /api/scores
    API->>API: 验证用户角色
    alt 角色为 expert
        API->>DB: 保存评分
        API->>DB: 更新任务统计
        API-->>FE: 返回成功
        FE-->>E: 显示"评分已提交"
    else 角色不是 expert
        API-->>FE: 403 权限不足
        FE-->>E: 显示错误提示
    end
```

![评分界面](docs/images/22-scoring-interface.png)
*图 5.7：评分界面 - 专家可以对分离结果进行质量评分*

统计（所有人可查看）：
- `GET /api/scores/stats`
- `GET /api/scores/stats/detailed`
- `GET /api/scores/stats/algorithm-comparison`

```mermaid
graph LR
    Stats[统计页面] --> Overall[总体统计]
    Stats --> Detailed[详细统计]
    Stats --> Comparison[算法对比]
    
    Overall --> TotalTasks[总任务数]
    Overall --> TotalScores[总评分数]
    Overall --> AvgScore[平均分]
    
    Detailed --> ByAlgorithm[按算法统计]
    Detailed --> ByUser[按用户统计]
    Detailed --> ByTime[按时间统计]
    
    Comparison --> Radar[雷达图]
    Comparison --> BarChart[柱状图]
    Comparison --> LineChart[折线图]
```

![统计图表](docs/images/23-stats-charts.png)
*图 5.8：统计图表 - 展示算法对比和社区评分数据*

![算法对比雷达图](docs/images/24-algorithm-comparison.png)
*图 5.9：算法对比雷达图 - 多维度对比不同算法的性能*

---

### 5.4 公共音频资源（公开资源页）

公开浏览：
- `GET /api/audio/resources`（支持丰富筛选：分类/关键词/上传者/标签/格式/时长/大小/排序/分页）
- `GET /api/audio/resources/{id}`
- `GET /api/audio/resources/{id}/download`
- `GET /api/audio/categories`
- `GET /api/audio/tags`
- `GET /api/audio/formats`

![公共资源页面](docs/images/25-audio-resources.png)
*图 5.10：公共音频资源页面 - 支持搜索、筛选和浏览*

登录用户上传资源：
- `POST /api/audio/resources/upload`

![上传资源界面](docs/images/26-upload-resource.png)
*图 5.11：上传资源界面 - 用户可以上传音频资源并添加标签和分类*

---

## 6. 作为管理员管理系统（用户/资源/系统管理）

### 6.1 管理员入口与页面结构（前端）

管理员登录后，前端会把你送进可分享的 URL：
- `/admin/users` 用户管理
- `/admin/audio` 音频资源管理
- `/admin/system/logs` 系统日志
- `/admin/system/settings` 系统设置
- `/admin/system/notifications` 通知中心
- `/admin/system/analytics` 数据统计

```mermaid
flowchart LR
  A["管理员登录"] --> B["/admin/users"]
  B --> C["/admin/audio"]
  C --> D["/admin/system/logs"]
  D --> E["/admin/system/settings"]
  E --> F["/admin/system/notifications"]
  F --> G["/admin/system/analytics"]
```

![管理员后台导航](docs/images/27-admin-dashboard.png)
*图 6.1：管理员后台导航 - 展示各个管理模块的入口*

![管理员后台概览](docs/images/28-admin-overview.png)
*图 6.2：管理员后台概览 - 显示用户、资源、系统等管理模块*

---

### 6.2 审批专家/管理员申请

审批列表：
- `GET /api/auth/pending`

批准申请：
- `POST /api/auth/approve_application/{app_id}`

拒绝申请（可带 reason，并会尝试发邮件）：
- `POST /api/auth/reject_application/{app_id}`

```mermaid
flowchart TD
    Admin[管理员登录] --> ViewPending[查看待审批列表]
    ViewPending --> SelectApp[选择申请]
    SelectApp --> Decision{审批决定}
    Decision -->|批准| Approve[批准申请]
    Decision -->|拒绝| Reject[拒绝申请]
    Approve --> CreateUser[创建 User 账号]
    CreateUser --> DeletePending[删除 PendingUser]
    DeletePending --> Notify[发送通知邮件]
    Reject --> AddReason[添加拒绝原因]
    AddReason --> DeletePending
    Notify --> Done[完成]
    
    style Approve fill:#4caf50
    style Reject fill:#f44336
```

```mermaid
sequenceDiagram
    participant A as 管理员
    participant FE as 前端
    participant API as 后端
    participant DB as 数据库
    participant Email as 邮件服务
    
    A->>FE: 进入审批页面
    FE->>API: GET /api/auth/pending
    API->>DB: 查询 PendingUser
    DB-->>API: 返回待审批列表
    API-->>FE: 返回申请列表
    FE-->>A: 显示待审批申请
    
    A->>FE: 点击批准/拒绝
    FE->>API: POST /api/auth/approve_application/{id}
    alt 批准
        API->>DB: 创建 User 账号
        API->>DB: 删除 PendingUser
        API->>Email: 发送批准通知
        API-->>FE: 返回成功
    else 拒绝
        API->>DB: 删除 PendingUser
        API->>Email: 发送拒绝通知（含原因）
        API-->>FE: 返回成功
    end
    FE-->>A: 显示操作结果
```

![用户审批界面](docs/images/29-user-approval.png)
*图 6.3：用户审批界面 - 管理员可以批准或拒绝专家/管理员的注册申请*

---

### 6.3 管理音频资源（管理员）

管理员资源管理 API：
- `POST /api/admin/audio/upload`
- `GET /api/admin/audio`
- `GET /api/admin/audio/{id}`
- `PUT /api/admin/audio/{id}`
- `DELETE /api/admin/audio/{id}`
- `POST /api/admin/audio/batch_delete`
- `GET /api/admin/audio/stats`
- `GET /api/admin/audio/{id}/download`
- `POST /api/admin/audio/{id}/reanalyze`（重新分析时长）

![音频资源管理](docs/images/30-audio-management.png)
*图 6.4：音频资源管理界面 - 管理员可以上传、编辑、删除音频资源*

---

### 6.4 系统管理（日志/设置/通知/统计）

```mermaid
flowchart TD
  S["系统管理 SystemManagement.jsx"] --> L["系统日志<br/>/api/admin/system/logs"]
  S --> C["系统设置<br/>/api/admin/system/configs"]
  S --> N["通知中心<br/>/api/admin/system/notifications"]
  S --> A["数据统计<br/>/api/admin/system/analytics/stats"]
```

![系统管理模块](docs/images/31-system-management.png)
*图 6.5：系统管理模块 - 包含日志、设置、通知、统计四个子模块*

系统日志：
- `GET /api/admin/system/logs`
- `GET /api/admin/system/logs/export`（CSV 导出）

![系统日志界面](docs/images/32-system-logs.png)
*图 6.6：系统日志界面 - 查看和导出系统运行日志*

系统设置：
- `GET /api/admin/system/configs`
- `POST /api/admin/system/configs`
- `GET /api/admin/system/configs/{key}`
- `PUT /api/admin/system/configs/{key}`
- `POST /api/admin/system/configs/init-defaults`（初始化默认配置项）

![系统设置界面](docs/images/33-system-settings.png)
*图 6.7：系统设置界面 - 管理员可以修改系统配置项*

通知中心（管理员端）：
- `GET /api/admin/system/notifications`
- `POST /api/admin/system/notifications`
- `PUT /api/admin/system/notifications/{id}/read`
- `GET /api/admin/system/notifications/unread-count`

![通知中心](docs/images/34-notification-center.png)
*图 6.8：通知中心 - 查看和管理系统通知*

数据统计：
- `GET /api/admin/system/analytics/stats?days=...`

![数据统计图表](docs/images/35-analytics-dashboard.png)
*图 6.9：数据统计仪表板 - 展示系统使用情况和数据分析*

---

## 7. 配置与运行参数（环境变量 + SystemConfig）

### 7.1 两套配置来源：为什么你改了 .env 却没生效？

后端存在两种配置来源：
- **环境变量**：`backend/.env`（启动时由 `python-dotenv` 加载）
- **系统设置表**：`SystemConfig`（通过系统管理页面可修改）

经验法则：
- **能在系统设置里改的，优先以 SystemConfig 为准**
- 没有 SystemConfig 的项，才回退到环境变量或代码默认值

```mermaid
flowchart LR
  K["读取配置 key"] --> A{"SystemConfig 中存在?"}
  A -->|是| SC["使用 SystemConfig.value"]
  A -->|否| EV{"环境变量存在?"}
  EV -->|是| ENV["使用 env var"]
  EV -->|否| DEF["使用代码默认值"]
```

![配置优先级示意图](docs/images/36-config-priority.png)
*图 7.1：配置优先级示意图 - 展示 SystemConfig、环境变量、默认值的优先级关系*

---

### 7.2 邮件配置（SMTP）：如何配置你自己的邮箱

**重要**：默认配置使用的是示例邮箱，你需要配置自己的邮箱才能正常发送验证码邮件。

```mermaid
flowchart TD
    Config[配置邮件] --> Choose{选择配置方式}
    Choose -->|方式一| EnvVar[环境变量配置]
    Choose -->|方式二| SystemConfig[系统设置配置]
    
    EnvVar --> EditEnv[编辑 .env 文件]
    EditEnv --> SetSMTP[设置 SMTP 参数]
    SetSMTP --> Restart[重启 Docker]
    
    SystemConfig --> LoginAdmin[登录管理员]
    LoginAdmin --> SystemSettings[进入系统设置]
    SystemSettings --> EditConfig[编辑 email.* 配置]
    EditConfig --> Save[保存配置]
    
    Restart --> Test[测试邮件发送]
    Save --> Test
    Test --> Success{发送成功?}
    Success -->|是| Done[配置完成]
    Success -->|否| Check[检查配置和日志]
    
    style Success fill:#ffeb3b
    style Done fill:#4caf50
    style Check fill:#f44336
```

#### 方式一：通过环境变量配置（推荐，适合 Docker）

在仓库根目录创建 `.env` 文件（或修改现有 `.env`），添加以下配置：

```bash
# 邮件投递模式：mock（仅记录日志，不实际发送）或 smtp（真实发送）
EMAIL_DELIVERY_MODE=smtp

# SMTP 服务器配置
SMTP_HOST=smtp.qq.com          # SMTP 服务器地址
SMTP_PORT=587                  # SMTP 端口（QQ邮箱常用587，Gmail常用465）
SMTP_USER=your_email@qq.com    # 你的邮箱地址
SMTP_PASS=your_auth_code      # 邮箱授权码/应用密码（不是登录密码！）
MAIL_FROM=your_email@qq.com    # 发件人邮箱（通常与SMTP_USER相同）
```

然后重启后端进程（重新运行 `uvicorn` 或 `python run.py`）。

#### 方式二：通过系统管理页面配置（适合运行时修改）

1. 登录管理员账号
2. 进入“系统管理” → “系统设置”
3. 找到 `email.*` 开头的配置项，修改：
   - `email.smtp_host`
   - `email.smtp_port`
   - `email.smtp_user`
   - `email.smtp_password`（敏感信息，建议用环境变量）
   - `email.mail_from`
   - `email.delivery_mode`（改为 `smtp`）

#### 常见邮箱服务商配置示例

**QQ 邮箱**：
```bash
EMAIL_DELIVERY_MODE=smtp
SMTP_HOST=smtp.qq.com
SMTP_PORT=587                    # 或 465（SSL）
SMTP_USER=your_qq@qq.com
SMTP_PASS=xxxxxxxxxxxxx         # 16位授权码（见下方获取方法）
MAIL_FROM=your_qq@qq.com
```
- 获取授权码：登录 QQ 邮箱 → 设置 → 账户 → 开启“POP3/SMTP服务” → 生成授权码

**Gmail**：
```bash
EMAIL_DELIVERY_MODE=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465                    # 或 587（TLS）
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password      # 应用专用密码（见下方获取方法）
MAIL_FROM=your_email@gmail.com
```
- 获取应用密码：Google 账户 → 安全性 → 两步验证 → 应用专用密码 → 生成

**163 邮箱**：
```bash
EMAIL_DELIVERY_MODE=smtp
SMTP_HOST=smtp.163.com
SMTP_PORT=465
SMTP_USER=your_email@163.com
SMTP_PASS=your_auth_code         # 授权码
MAIL_FROM=your_email@163.com
```

**Outlook/Hotmail**：
```bash
EMAIL_DELIVERY_MODE=smtp
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_USER=your_email@outlook.com
SMTP_PASS=your_password          # 或应用密码
MAIL_FROM=your_email@outlook.com
```

#### 测试邮件配置

配置完成后，尝试注册一个新账号：
1. 访问 `http://localhost:3000`
2. 点击“注册”，输入邮箱和验证码
3. 如果配置正确，验证码会发送到你的邮箱
4. 如果配置错误，查看后端日志（在运行后端的终端中搜索 `EMAIL` 关键字）。

#### 开发环境建议

如果只是本地测试，可以暂时使用 `EMAIL_DELIVERY_MODE=mock`：
- 验证码会打印在后端控制台日志中（格式：`[EMAIL MOCK] to=xxx code=xxxxxx`）
- 不会实际发送邮件，避免配置邮箱的麻烦

---

### 7.3 MSS 源分离引擎配置

**SEPARATION_ENGINE**：分离引擎类型
- `mss`（默认）：使用 ZFTurbo/Music-Source-Separation-Training 本地引擎
- `mock`：模拟引擎（用于测试，不进行实际分离）
- `http`：HTTP 远程引擎（需要配置 `MODEL_HTTP_URL`）

```mermaid
flowchart TD
    Engine[分离引擎] --> Type{引擎类型}
    Type -->|mss| Local[本地 MSS 引擎]
    Type -->|mock| Mock[模拟引擎]
    Type -->|http| Remote[远程 HTTP 引擎]
    
    Local --> CheckMSS{MSS 仓库存在?}
    CheckMSS -->|否| Error1[错误: MSS 未配置]
    CheckMSS -->|是| CheckModels{模型文件存在?}
    CheckModels -->|否| Error2[错误: 模型未找到]
    CheckModels -->|是| CheckDeps{依赖已安装?}
    CheckDeps -->|否| Install[安装依赖]
    CheckDeps -->|是| Ready[引擎就绪]
    Install --> Ready
    
    Mock --> MockReady[模拟引擎就绪<br/>返回测试数据]
    
    Remote --> CheckURL{HTTP URL 配置?}
    CheckURL -->|否| Error3[错误: URL 未配置]
    CheckURL -->|是| RemoteReady[远程引擎就绪]
    
    style Error1 fill:#f44336
    style Error2 fill:#f44336
    style Error3 fill:#f44336
    style Ready fill:#4caf50
    style MockReady fill:#ff9800
    style RemoteReady fill:#2196f3
```

**MSS 相关环境变量**（在本地运行环境中配置，例如 `backend/.env` 或操作系统环境变量）：
- **MSS_ROOT_DIR**：MSS 仓库路径（本机路径，例如 `D:/code/AudioLab/Music-Source-Separation-Training-main`）
- **MSS_MDX23C_CKPT**：MDX23C 模型权重路径（例如 `D:/code/models/mss/model_mdx23c_ep_168_sdr_7.0207.ckpt`）
- **MSS_DEMUCS4HT_CKPT**：Demucs4HT 模型权重路径（例如 `D:/code/models/mss/955717e8-8726e21a.th`）
- **MSS_BS_ROFORMER_CKPT**：Band Split RoFormer 模型权重路径（例如 `D:/code/models/mss/model_bs_roformer_ep_17_sdr_9.6568.ckpt`）
- **MSS_SCNET_CKPT**：SCNet 模型权重路径（例如 `D:/code/models/mss/scnet_checkpoint_musdb18.ckpt`）

**可选：覆盖 MSS 配置文件（高级）**：
- 你也可以通过环境变量覆盖每个模型的 `config_path`（不设置则使用 MSS 仓库 `configs/` 下的默认值）：
  - **MSS_MDX23C_CONFIG**
  - **MSS_DEMUCS4HT_CONFIG**
  - **MSS_BS_ROFORMER_CONFIG**
  - **MSS_SCNET_CONFIG**
- 如果你遇到类似 `size mismatch ... to_freqs ... torch.Size([768, 384]) ... torch.Size([768, 192])` 的报错，基本可判定为 **checkpoint 与 config 不匹配**。此时请将 `MSS_BS_ROFORMER_CONFIG` 指向与你的 ckpt 版本匹配的配置文件（例如 `config_musdb18_bs_roformer_384_8_2_485100_sage.yaml` 或 `config_musdb18_bs_roformer.yaml`）。

**注意事项**：
- 确保模型文件已下载到指定目录（例如 `D:\code\models\mss`）
- 如果模型路径不同，请通过环境变量覆盖默认值（见上面 `MSS_*_CKPT`）
- MSS 依赖（PyTorch 等）需要在本地虚拟环境中提前安装好

### 7.4 其他重要环境变量清单

- **DATABASE_URL**：MySQL 连接串（`mysql+aiomysql://user:pass@host:port/db`）
- **JWT_SECRET**：JWT 密钥（建议改成强随机字符串）
- **MODEL_HTTP_URL / MODEL_HTTP_TIMEOUT_S**：`SEPARATION_ENGINE=http` 时使用
- **AUDIO_RESOURCE_DIR**：音频资源目录（用于 `/audio_resources` 静态挂载）

---

## 8. 对接与联调：API 速查表

```mermaid
graph TB
    subgraph "API 分类"
        System[系统 API]
        Auth[认证 API]
        Tasks[任务 API]
        Scores[评分 API]
        Audio[音频资源 API]
        Admin[管理员 API]
    end
    
    System --> Health[GET /health]
    System --> Docs[GET /docs]
    
    Auth --> Register[POST /register]
    Auth --> Login[POST /login]
    Auth --> Pending[GET /pending]
    
    Tasks --> Upload[POST /upload]
    Tasks --> GetTask[GET /{task_id}]
    Tasks --> GetStems[GET /{task_id}/stems]
    
    Scores --> Submit[POST /]
    Scores --> Stats[GET /stats]
    
    Audio --> List[GET /resources]
    Audio --> UploadRes[POST /upload]
    
    Admin --> Users[/users]
    Admin --> AudioAdmin[/audio]
    Admin --> SystemAdmin[/system]
    
    style System fill:#2196f3,color:#fff
    style Auth fill:#4caf50,color:#fff
    style Tasks fill:#ff9800
    style Scores fill:#9c27b0,color:#fff
    style Audio fill:#00bcd4,color:#fff
    style Admin fill:#f44336,color:#fff
```

### 8.1 系统
- `GET /health`
- `GET /`（版本与 docs 入口）
- `http://localhost:8000/docs`

### 8.2 认证
- `POST /api/auth/send_code`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/upload_avatar`
- `GET /api/auth/pending`（管理员）
- `POST /api/auth/approve_application/{app_id}`（管理员）
- `POST /api/auth/reject_application/{app_id}`（管理员）

### 8.3 分离任务

```mermaid
sequenceDiagram
    participant Client as 客户端
    participant API as FastAPI
    participant DB as 数据库
    participant MSS as MSS 引擎
    participant FS as 文件系统
    
    Client->>API: POST /api/tasks/upload?algorithm=MDX23C
    API->>FS: 保存文件到 /uploads
    API->>DB: 创建 SeparationTask
    API-->>Client: 返回 task_id
    
    loop 轮询状态
        Client->>API: GET /api/tasks/{task_id}
        API->>DB: 查询任务状态
        alt 处理中
            DB-->>API: status=processing
            API-->>Client: 返回处理中
        else 已完成
            DB-->>API: status=completed
            API-->>Client: 返回完成
        end
    end
    
    Client->>API: GET /api/tasks/{task_id}/stems
    API->>DB: 查询 StemFile
    DB-->>API: 返回 stems 列表
    API-->>Client: 返回 stems
    
    Client->>API: GET /api/tasks/{task_id}/stems/{stem_id}/download
    API->>FS: 读取文件
    FS-->>API: 返回文件流
    API-->>Client: 返回音频文件
    
    Note over API,MSS: 后台异步处理
    API->>MSS: 调用分离引擎
    MSS->>FS: 保存分离结果
    MSS->>DB: 更新任务状态
```

- `POST /api/tasks/upload?algorithm=...`（algorithm 可选：`MDX23C`、`Demucs4HT`、`Band Split RoFormer`、`SCNet`）
- `GET /api/tasks/{task_id}`（task_id 为字符串，支持大整数）
- `GET /api/tasks/{task_id}/stems`
- `GET /api/tasks/{task_id}/stems/{stem_id}/download`
- `GET /api/tasks/{task_id}/analysis?target=Vocals&include_all_stems=true`

### 8.4 评分与统计
- `POST /api/scores`（仅专家）
- `GET /api/scores`
- `GET /api/scores/stats`
- `GET /api/scores/stats/detailed`
- `GET /api/scores/stats/algorithm-comparison`

### 8.5 公共音频资源
- `GET /api/audio/resources`
- `GET /api/audio/resources/{id}`
- `GET /api/audio/resources/{id}/download`
- `GET /api/audio/categories`
- `GET /api/audio/tags`
- `GET /api/audio/formats`
- `POST /api/audio/resources/upload`（登录用户）

### 8.6 管理员后台
- `GET /api/admin/users` / `PUT/DELETE ...`
- `POST /api/admin/audio/upload` / `GET/PUT/DELETE ...`
- `/api/admin/system/*`

---

## 9. 故障排查（FAQ）

```mermaid
flowchart TD
    Problem[遇到问题] --> Identify{问题类型}
    
    Identify -->|邮件问题| EmailIssue[邮件相关]
    Identify -->|连接问题| ConnectionIssue[连接相关]
    Identify -->|任务问题| TaskIssue[任务相关]
    Identify -->|MSS问题| MSSIssue[MSS 相关]
    Identify -->|其他| OtherIssue[其他问题]
    
    EmailIssue --> CheckEmailConfig[检查邮件配置]
    CheckEmailConfig --> CheckLogs[查看日志]
    CheckLogs --> EmailSolution[解决方案]
    
    ConnectionIssue --> CheckDocker[检查 Docker]
    CheckDocker --> CheckPorts[检查端口]
    CheckPorts --> ConnectionSolution[解决方案]
    
    TaskIssue --> CheckTaskStatus[检查任务状态]
    CheckTaskStatus --> CheckDB[检查数据库]
    CheckDB --> TaskSolution[解决方案]
    
    MSSIssue --> CheckDeps[检查依赖]
    CheckDeps --> CheckModels[检查模型]
    CheckModels --> CheckLogs2[查看 MSS 日志]
    CheckLogs2 --> MSSSolution[解决方案]
    
    OtherIssue --> CheckDocs[查看文档]
    CheckDocs --> CheckGitHub[查看 GitHub Issues]
    
    style Problem fill:#ff9800
    style EmailSolution fill:#4caf50
    style ConnectionSolution fill:#4caf50
    style TaskSolution fill:#4caf50
    style MSSSolution fill:#4caf50
```

![故障排查流程图](docs/images/37-troubleshooting-flow.png)
*图 9.0：故障排查流程图 - 常见问题的诊断步骤*

### 9.1 "收不到验证码邮件"

```mermaid
flowchart TD
    NoEmail[收不到邮件] --> CheckMode{邮件模式?}
    
    CheckMode -->|mock| MockMode[正常现象<br/>查看后端日志]
    MockMode --> ViewLogs[查看日志获取验证码]
    
    CheckMode -->|smtp| SMTPMode[检查 SMTP 配置]
    SMTPMode --> CheckConfig[检查配置项]
    CheckConfig --> CheckAuth{授权码正确?}
    CheckAuth -->|否| FixAuth[使用授权码而非密码]
    CheckAuth -->|是| CheckPort{端口正确?}
    CheckPort -->|否| TryPort[尝试 587 或 465]
    CheckPort -->|是| CheckService{服务商设置?}
    CheckService -->|否| EnableSMTP[开启 SMTP 服务]
    CheckService -->|是| CheckSpam[检查垃圾箱]
    CheckSpam --> CheckPriority{SystemConfig 优先级?}
    CheckPriority -->|是| UpdateConfig[更新系统设置]
    CheckPriority -->|否| CheckLogs[查看错误日志]
    
    style MockMode fill:#2196f3,color:#fff
    style FixAuth fill:#ff9800
    style EnableSMTP fill:#ff9800
    style UpdateConfig fill:#4caf50
```

**情况一：使用 mock 模式（开发环境）**
- 这是正常现象，邮件不会实际发送
- 验证码会打印在后端日志中，格式：`[EMAIL MOCK] to=xxx code=xxxxxx`
- 查看日志：在运行后端的终端中查找 `[EMAIL MOCK]` 相关输出

**情况二：使用 smtp 模式但收不到邮件**
1. **检查配置是否正确**：确认后端运行环境中的 `SMTP_*` 相关环境变量或 `backend/.env` 已正确设置。
2. **确认使用的是授权码，不是登录密码**：
   - QQ 邮箱：需要在邮箱设置中生成 16 位授权码
   - Gmail：需要使用"应用专用密码"，不是普通密码
   - 163 邮箱：需要在设置中开启 SMTP 并生成授权码
3. **检查端口和加密方式**：
   - 587 端口：通常使用 TLS（STARTTLS）
   - 465 端口：通常使用 SSL
   - 如果 587 不行，试试 465，反之亦然
4. **查看后端错误日志**：在运行后端的终端或日志文件中搜索 `email` / `smtp` / `error` 关键字。
5. **检查垃圾箱**：部分邮箱服务商可能将验证码邮件标记为垃圾邮件
6. **确认邮箱服务商是否允许第三方登录**：
   - Gmail：需要开启"允许不够安全的应用访问"（或使用应用专用密码）
   - QQ 邮箱：需要开启"POP3/SMTP服务"

**情况三：配置了环境变量但系统仍使用旧配置**
- 系统配置表（SystemConfig）优先级高于环境变量
- 解决方案：
  1. 登录管理员后台 → 系统管理 → 系统设置
  2. 找到 `email.*` 配置项，确认值是否正确
  3. 或者删除 SystemConfig 中的邮件配置项，让系统使用环境变量

---

### 9.2 “前端连不上后端（Failed to fetch / CORS / ERR_CONNECTION_REFUSED）”

- 确认后端启动：`http://localhost:8000/health`
- 确认前端 `.env`：
  - `REACT_APP_API_BASE=http://localhost:8000`
  - 修改后必须重启 `npm start`

---

### 9.3 “默认账号是什么？我用 admin@audiolab.com 登录失败”

默认账号不是 `admin@audiolab.com`。请以本地执行 `python -m app.create_admin` 的输出为准：  
脚本会创建/更新 **guest / expert / admin** 三个账号。

---

### 9.4 “任务完成了但 stem 播放失败 / 409 empty”

后端对 **0 字节 stem 文件**会返回 `409`，避免浏览器 Range 播放触发 416：
- 检查 `SEPARATION_ENGINE` 是否真的产生了有效 wav
- 检查写目录权限：`/app/uploads`、`/app/results`

### 9.5 "MSS 算法分离失败 / ModuleNotFoundError"

**情况一：MSS 依赖未安装或不完整**
- 建议在本地虚拟环境中手动安装并验证：
  ```bash
  cd backend
  .\.venv\Scripts\Activate.ps1  # Windows
  # 或 source .venv/bin/activate  # macOS / Linux
  python -c "import torch; import librosa; print('OK')"
  ```

![MSS 依赖检查](docs/images/38-mss-dependency-check.png)
*图 9.5.1：MSS 依赖检查 - 如何验证依赖是否安装完成*

**情况二：模型文件不存在**
- 检查模型文件是否已下载到指定目录（例如 `D:\code\models\mss`）
- 检查环境变量中的模型路径是否与实际路径一致

![模型文件检查](docs/images/39-model-files-check.png)
*图 9.5.2：模型文件检查 - 验证模型文件是否正确挂载*

**情况三：MSS 推理脚本执行失败**
- 查看后端终端输出，聚焦 `MSS inference` 相关错误
- 检查 MSS 仓库路径（如 `Music-Source-Separation-Training-main`）是否正确，且 `inference.py` 可被导入
- 检查 Python 版本兼容性（建议使用 Python 3.10）

![MSS 推理错误诊断](docs/images/40-mss-inference-error.png)
*图 9.5.3：MSS 推理错误诊断 - 常见错误和解决方案*

**情况四：CUDA/GPU 相关问题**
- 当前系统在无额外配置时默认使用 CPU 模式
- CPU 模式运行较慢但功能正常
- 如需 GPU 加速，可在本地环境中安装支持 CUDA 的 PyTorch，并确保显卡驱动与 CUDA 版本兼容

![GPU 配置示意图](docs/images/41-gpu-configuration.png)
*图 9.5.4：GPU 配置示意图 - CPU 模式 vs GPU 模式的区别*

### 9.6 “任务 ID 查询返回 404 / Task not found”

**原因**：任务 ID 过大导致 JavaScript 精度丢失

**解决方案**：已修复，后端现在支持字符串类型的任务 ID。如果仍遇到问题：
- 刷新浏览器页面（清除缓存）
- 在运行后端的终端或日志文件中搜索 `task_id` 相关错误

---

## 10. 已知限制（按当前代码）

```mermaid
mindmap
  root((已知限制))
    功能限制
      匿名上传支持
      评分仅专家
      无密码找回
      无密码修改
    技术限制
      CPU 模式默认
      GPU 需额外配置
      MSS 安装耗时
      模型需手动下载
    架构限制
      Firestore 禁用
      使用 localStorage
      后端 + 前端架构
```

- **任务用户绑定**：`/api/tasks/*` 当前允许匿名上传，任务 `user_id` 可能是 `"anonymous"`（见 `tasks.py`）
- **评分权限**：`POST /api/scores` 仅允许 `expert` 角色提交（见 `scores.py`）
- **Firestore**：前端 Firestore 代码处于"暂时禁用/注释保留"状态，当前主流程使用后端 + localStorage
- **修改密码/找回密码**：目前无对应 UI 与 API
- **MSS 算法性能**：
  - 默认使用 CPU 模式，处理速度较慢（几分钟到十几分钟，取决于音频长度）
  - GPU 加速需要在本地环境中正确安装 CUDA / PyTorch
  - MSS 依赖首次安装需要一定时间（取决于网络与机器性能）
- **模型文件**：需要手动下载模型权重文件到指定目录（见 3.2 节）

---

## 11. 快速参考图表

### 11.1 完整系统工作流

```mermaid
flowchart TB
    Start([用户访问系统]) --> Login{已登录?}
    Login -->|否| Register[注册账号]
    Login -->|是| Main[主界面]
    Register --> Verify[邮箱验证]
    Verify --> Approve{需要审批?}
    Approve -->|是| Wait[等待审批]
    Approve -->|否| Main
    Wait --> Main
    
    Main --> Upload[上传音频]
    Upload --> Select[选择算法]
    Select --> Process[处理任务]
    Process --> Results[查看结果]
    Results --> Play[播放对比]
    Play --> Score{是专家?}
    Score -->|是| SubmitScore[提交评分]
    Score -->|否| ViewStats[查看统计]
    SubmitScore --> ViewStats
    
    Main --> Resources[浏览资源]
    Main --> Admin{是管理员?}
    Admin -->|是| Manage[管理后台]
    Manage --> UserMgmt[用户管理]
    Manage --> AudioMgmt[资源管理]
    Manage --> SystemMgmt[系统管理]
    
    style Start fill:#2196f3,color:#fff
    style Main fill:#4caf50,color:#fff
    style Process fill:#ff9800
    style Results fill:#9c27b0,color:#fff
```

### 11.2 算法对比矩阵

```mermaid
graph TB
    subgraph "支持的算法"
        MDX[MDX23C<br/>基于 MDX 架构]
        Demucs[Demucs4HT<br/>Demucs v4 变体]
        BSRoFormer[Band Split RoFormer<br/>Transformer 架构]
        SCNet[SCNet<br/>卷积网络]
    end
    
    subgraph "算法特点"
        Fast[处理速度]
        Quality[分离质量]
        Memory[内存占用]
        Accuracy[准确度]
    end
    
    MDX --> Fast
    MDX --> Quality
    Demucs --> Quality
    Demucs --> Memory
    BSRoFormer --> Accuracy
    BSRoFormer --> Quality
    SCNet --> Fast
    SCNet --> Memory
```

### 11.3 文件存储结构

```mermaid
graph TD
    Root[/app] --> Uploads[/uploads<br/>原始音频]
    Root --> Results[/results<br/>分离结果]
    Root --> Resources[/audio_resources<br/>公共资源]
    Root --> Avatars[/download/avatar<br/>用户头像]
    Root --> MSS[/mss<br/>MSS 仓库]
    Root --> Models[/models/mss<br/>模型权重]
    
    Uploads --> Task1[task_xxx.mp3]
    Results --> Task1Result[task_xxx/]
    Task1Result --> Vocals[Vocals.wav]
    Task1Result --> Drums[Drums.wav]
    Task1Result --> Bass[Bass.wav]
    Task1Result --> Other[Other.wav]
    
    Models --> MDXModel[MDX23C.ckpt]
    Models --> DemucsModel[Demucs4HT.th]
    Models --> BSRoModel[BS_RoFormer.ckpt]
    Models --> SCNModel[SCNet.ckpt]
    
    style Root fill:#2196f3,color:#fff
    style Uploads fill:#4caf50,color:#fff
    style Results fill:#ff9800
    style Models fill:#9c27b0,color:#fff
```

### 11.4 任务状态流转

```mermaid
stateDiagram-v2
    [*] --> pending: 创建任务
    pending --> processing: 开始处理
    processing --> completed: 分离成功
    processing --> failed: 分离失败
    completed --> [*]
    failed --> [*]
    
    note right of pending
        任务已创建
        等待处理
    end note
    
    note right of processing
        MSS 引擎运行中
        生成分离结果
    end note
    
    note right of completed
        所有 stems 已生成
        可以下载播放
    end note
    
    note right of failed
        分离过程出错
        查看日志排查
    end note
```

---

## 11. 图片资源说明

本文档中引用的所有图片应存放在 `docs/images/` 目录下。以下是图片清单：

### 用户界面截图
- `01-main-dashboard.png` - 主界面
- `02-separation-results.png` - 分离结果展示
- `16-auth-page.png` - 注册/登录界面
- `18-algorithm-selection.png` - 算法选择
- `19-upload-audio.png` - 上传音频
- `20-task-progress.png` - 任务进度
- `21-separation-results.png` - 分离结果
- `22-scoring-interface.png` - 评分界面
- `23-stats-charts.png` - 统计图表
- `24-algorithm-comparison.png` - 算法对比
- `25-audio-resources.png` - 公共资源
- `26-upload-resource.png` - 上传资源

### 管理员界面截图
- `03-admin-dashboard.png` - 管理员后台
- `27-admin-dashboard.png` - 管理员导航
- `28-admin-overview.png` - 管理员概览
- `29-user-approval.png` - 用户审批
- `30-audio-management.png` - 音频管理
- `31-system-management.png` - 系统管理
- `32-system-logs.png` - 系统日志
- `33-system-settings.png` - 系统设置
- `34-notification-center.png` - 通知中心
- `35-analytics-dashboard.png` - 数据统计

### 安装和配置截图
- `09-model-files.png` - 模型文件目录
- `11-pytorch-install.png` - PyTorch 安装
- `12-startup-success.png` - 启动成功
- `13-db-init.png` - 数据库初始化
- `14-system-config-init.png` - 系统设置初始化
- `15-create-admin.png` - 创建默认账号

### 架构和流程图
- `05-system-architecture.png` - 系统架构
- `06-data-flow.png` - 数据流转
- `07-user-roles.png` - 用户角色
- `17-login-flow.png` - 登录流程
- `36-config-priority.png` - 配置优先级

### 故障排查示意图
- `37-troubleshooting-flow.png` - 故障排查流程
- `38-mss-dependency-check.png` - MSS 依赖检查
- `39-model-files-check.png` - 模型文件检查
- `40-mss-inference-error.png` - MSS 推理错误
- `41-gpu-configuration.png` - GPU 配置

**注意**：如果图片不存在，请根据说明创建相应的截图或示意图。