# AudioLab 学校服务器部署

## 0. 一键部署（新服务器，推荐）

新服务器（仅 1 张卡、无任何环境）按下面两步即可一键部署完成（自动装系统依赖 / Node / Miniconda+mss 推理环境 / 拉代码 / 下载模型权重 / 恢复 MySQL / 建库建账号 / 构建前端 / 启动后端）。

**前置条件**
1. 新服务器已装好 NVIDIA 显卡驱动（`nvidia-smi` 可用，驱动 ≥ 525.60 以支持 cu124）。
2. 新服务器能访问 GitHub（仓库是私有的，需部署 key）、PyPI/conda 镜像、模型下载地址（GitHub Releases / `dl.fbaipublicfiles.com`）。
3. 新服务器为 root 用户、Ubuntu 22.04 x86_64。

**第 1 步：在当前服务器打包 MySQL（二进制 + 数据快照）**

```bash
cd /mnt/wzp/AudioLab
bash deploy/pack_mysql.sh          # 生成 /mnt/wzp/audiolab-mysql-portable.tar.gz
scp /mnt/wzp/audiolab-mysql-portable.tar.gz root@<新服务器IP>:/data/
```

**第 2 步：在新服务器一键部署**

```bash
# 先把部署 key 放到新服务器（或直接用已配置好权限的 ~/.ssh/id_ed25519）
git clone -b main git@github.com:WZP358/AudioLab.git /data/AudioLab
cd /data/AudioLab && sudo bash deploy/install.sh
```

脚本默认部署到 `/data/AudioLab`、模型 `/data/models/mss`、Miniconda `/opt/miniconda3`、MySQL 便携版 `/data/portable`（数据 `/data/mysql-data`）。单卡会自动设 `GPU_COUNT=1 / SEPARATION_WORKERS=1`。所有步骤幂等，可反复重跑。可用环境变量覆盖（见 `deploy/install.sh` 顶部配置区），例如 `AUDIOLAB_BASE_DIR=/mnt/wzp/AudioLab sudo bash deploy/install.sh`。

部署完成后访问 `http://<服务器IP>:8000`（默认账号 `admin/admin123`）。常用命令：`deploy/stop_backend.sh` 停止、`deploy/start_mysql.sh` 重启 MySQL、后端日志 `/tmp/audiolab.log`。

> 若新服务器网络无法访问 `dl.fbaipublicfiles.com`（Demucs4HT 权重，84MB），该权重会下载失败但不影响另外 3 个算法；可稍后在能访问的环境下载后手动放到 `$MODELS_DIR` 再重跑脚本补下。

---

## 1. 目录约定

建议项目放在 `/data/AudioLab`，模型仓库放在 `/data/Music-Source-Separation-Training`，权重放在 `/data/models/mss`。上传目录和结果目录必须持久化并纳入备份。

## 2. 安装依赖

```bash
sudo apt update
sudo apt install -y ffmpeg nginx mysql-server python3-venv
cd /data/AudioLab/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 3. 配置和初始化

```bash
cp .env.example .env
openssl rand -hex 32   # 将结果填入 JWT_SECRET
# 编辑 .env：数据库、MSS_ROOT_DIR、四个权重路径
python -m app.init_db
mysql -u audiolab -p audiolab < migrations/001_patent_scoring.sql
python -m app.init_system_configs
python -m app.create_admin
```

正式环境必须保持 `SEPARATION_ENGINE=mss` 和 `ALLOW_TEST_ENGINES=false`，不能用 mock 生成专利实验数据。

## 4. 前端构建

```bash
cd /data/AudioLab/frontend
npm ci
npm run build
```

生产构建不设置 `REACT_APP_API_BASE` 时，前端会自动使用当前网站域名，因此导师从另一台电脑访问不会错误请求 `localhost`。

## 5. 启动服务

```bash
sudo cp deploy/systemd/audiolab.service.example /etc/systemd/system/audiolab.service
# 修改 User 后执行
sudo systemctl daemon-reload
sudo systemctl enable --now audiolab
curl http://127.0.0.1:8000/health
```

用 `deploy/nginx/audiolab.conf.example` 配置 Nginx，先运行 `sudo nginx -t` 再 reload。校外访问应使用学校 VPN/堡垒机；若经学校批准开放公网，必须配置 HTTPS，不要直接开放 8000 端口。

## 6. 实验数据流程

管理员上传真实 Mixture/Gold 文件并完成分离任务后，在后台生成 15 秒盲化样本；三位专家完成盲化评分后，再导出主观评分、客观指标、盲化映射和音频样本。不要把测试数据当作专利实验数据。
