# AudioLab 学校服务器部署

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
