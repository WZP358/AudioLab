## 目录

- **1. 项目介绍**
- **2. 功能介绍**
- **3. 本地部署**


---

## 1. 项目介绍

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

![](./images/1.png)

![](./images/2.png)

![](./images/3.png)

![](./images/4.png)

### 1.3 主要功能概览

从整体功能视角看，AudioLab 主要提供：

- **多角色访问**：支持访客、专家、管理员三类角色，权限清晰，流程分离。
- **任务管理与结果浏览**：上传音频、选择算法创建分离任务，查看并播放各个 stem 结果。
- **评分与统计**：专家对任务进行多维度评分，并在前端查看统计与算法对比结果。
- **公共资源管理**：上传、浏览和下载公共音频资源，用于统一评测或 Demo 展示。
- **系统管理**：包括用户审批、系统配置、日志与通知等后台管理功能。

---

## 2. 功能介绍

从“谁在用”与“能做什么”两个角度，可以粗略理解为：

- **普通用户（访客/登录用户）**
  - 上传自己的音频，选择源分离算法创建任务。
  - 任务完成后在线试听原混音与分离后的各个 stem。
  - 浏览公开的音频资源与简单的统计信息。
- **专家用户**
  - 拥有普通用户全部能力。
  - 对指定任务的分离结果进行主观评分（质量、干扰、伪影等维度）。
  - 查看更细粒度的评分统计，用于研究或调参。
- **管理员**
  - 审核专家/管理员注册申请，管理系统内所有用户。
  - 维护公共音频资源库，管理系统配置、日志与通知。

---

## 3. 本地部署

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


# 5) 初始化数据库表结构、系统配置与默认账号
python -m app.init_db
python -m app.init_system_configs
python -m app.create_admin

# 6) 启动后端（开发模式，带热重载）
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

macOS / Linux（bash / zsh）示例：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt



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

### 3.5 启动前端 Web 界面（React）

后端成功启动后，你可以在本地启动前端来访问完整界面。

#### 3.5.1 安装前端依赖

前端位于仓库根目录下的 `frontend/`，使用 `react-scripts` 作为开发脚手架：

```powershell
cd D:\code\AudioLab\frontend
npm install
```

> 如使用 `pnpm` / `yarn`，可自行替换为对应安装命令。

#### 3.5.2 启动前端开发服务器

- 默认前端运行在 `http://localhost:3000`，已在后端 CORS 中显式允许：

```powershell
cd D:\code\AudioLab\frontend
npm start
```

打开浏览器访问：

- `http://localhost:3000`：用户端主界面（上传音频、创建分离任务、查看结果与统计）
- 管理员登录后可访问如 `/admin/users`、`/admin/audio`、`/admin/system/...` 等后台页面（由 `AdminDashboard.jsx` 和 `SystemManagement.jsx` 负责）。

> 注意：当前前端默认会将后端地址视为 `http://localhost:8000`，如需修改，可在前端 `.env` 或相关配置中调整 `REACT_APP_API_BASE`。



### 完整系统工作流

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

### 算法对比矩

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



