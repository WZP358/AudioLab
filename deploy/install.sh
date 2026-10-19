#!/usr/bin/env bash
# =============================================================================
# AudioLab 一键部署脚本（新服务器，Ubuntu 22.04 / 单卡）
#
# 用法（在新服务器上，root 用户）：
#     sudo bash install.sh
#
# 它会自动完成：装系统依赖 -> 装 Node -> 装 Miniconda + mss 推理环境 ->
# 拉取仓库 -> 下载模型权重 -> 恢复数据库(便携包或 SQL 快照，可选) -> 建后端 venv ->
# 生成 .env -> 初始化数据库/账号 -> 构建前端 -> 启动后端(看门狗保活)。
#
# 所有步骤幂等，可反复执行；中断后重跑会从断点附近继续。
#
# 可用环境变量覆盖默认值（见下方"配置区"）。
# =============================================================================
set -uo pipefail

# -----------------------------------------------------------------------------
# 配置区（按需覆盖）
# -----------------------------------------------------------------------------
BASE_DIR="${AUDIOLAB_BASE_DIR:-/data/AudioLab}"        # 项目根目录
DATA_ROOT="${AUDIOLAB_DATA_ROOT:-/data}"               # 数据/模型/MySQL 根
MODELS_DIR="${AUDIOLAB_MODELS_DIR:-/data/models/mss}"  # 模型权重目录
CONDA_PREFIX="${AUDIOLAB_CONDA_PREFIX:-/opt/miniconda3}"
MSS_ENV_NAME="${AUDIOLAB_MSS_ENV_NAME:-mss}"
MYSQL_DIR="${AUDIOLAB_MYSQL_DIR:-/data/portable}"      # 便携版 MySQL 二进制目录
MYSQL_DATA="${AUDIOLAB_MYSQL_DATA:-/data/mysql-data}"  # 便携版 MySQL 数据目录
MYSQL_TARBALL="${AUDIOLAB_MYSQL_TARBALL:-/data/audiolab-mysql-portable.tar.gz}"  # pack_mysql.sh 生成的包
DB_SQL="${AUDIOLAB_DB_SQL:-/data/audiolab.sql}"          # 可选：仅 SQL 快照（不拷便携二进制时，用系统 MySQL 导入）

GIT_REPO="${AUDIOLAB_GIT_REPO:-git@github.com:WZP358/AudioLab.git}"
GIT_BRANCH="${AUDIOLAB_GIT_BRANCH:-main}"
GIT_DEPLOY_KEY="${AUDIOLAB_GIT_DEPLOY_KEY:-}"          # 可选：指向可访问该私有仓库的私钥

NODE_VERSION="${AUDIOLAB_NODE_VERSION:-18.20.8}"       # 与 package-lock(lockfileVersion=3) 匹配
PYTORCH_INDEX_URL="${PYTORCH_INDEX_URL:-https://download.pytorch.org/whl/cu124}"
PIP_INDEX_URL="${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"
CONDA_MIRROR="${CONDA_MIRROR:-https://mirrors.tuna.tsinghua.edu.cn/anaconda}"
NODE_MIRROR="${NODE_MIRROR:-https://npmmirror.com/mirrors/node}"

MSS_PYTHON="$CONDA_PREFIX/envs/$MSS_ENV_NAME/bin/python"

# -----------------------------------------------------------------------------
# 小工具
# -----------------------------------------------------------------------------
c_red=$'\e[31m'; c_grn=$'\e[32m'; c_yel=$'\e[33m'; c_dim=$'\e[2m'; c_off=$'\e[0m'
info()  { echo -e "${c_grn}[*]${c_off} $*"; }
step()  { echo -e "\n${c_grn}==>${c_off} ${c_grn}$*${c_off}"; }
warn()  { echo -e "${c_yel}[!]${c_off} $*"; }
fail()  { echo -e "${c_red}[✗]${c_off} $*"; }
have()  { command -v "$1" >/dev/null 2>&1; }
die()   { fail "$*"; exit 1; }

as_root() {
  if [ "$(id -u)" -ne 0 ]; then
    fail "请用 root 运行：sudo bash install.sh"
    exit 1
  fi
}

# -----------------------------------------------------------------------------
# 0. 预检：系统 / GPU
# -----------------------------------------------------------------------------
detect_env() {
  step "预检环境"
  if ! have apt-get; then
    fail "仅支持 Debian/Ubuntu 系（未找到 apt-get）"
    exit 1
  fi
  . /etc/os-release
  info "OS: $PRETTY_NAME ($(uname -m))"

  if have nvidia-smi; then
    GPU_COUNT=$(nvidia-smi --query-gpu=name --format=csv,noheader | wc -l)
    DRIVER=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1)
    info "GPU: $GPU_COUNT 张，驱动 $DRIVER"
  else
    GPU_COUNT=1
    warn "未检测到 nvidia-smi（显卡驱动可能未安装）。后端仍可启动，但 MSS 推理会退回 CPU。"
    warn "若需 GPU 推理，请先安装 NVIDIA 驱动（>=525 以支持 cu124）。"
  fi

  # 校验驱动是否支持 cu124（要求 >= 525.60）
  if have nvidia-smi; then
    local drv_maj drv_min
    drv_maj=$(echo "$DRIVER" | cut -d. -f1)
    drv_min=$(echo "$DRIVER" | cut -d. -f2)
    if [ "${drv_maj:-0}" -lt 525 ] || { [ "${drv_maj:-0}" -eq 525 ] && [ "${drv_min:-0}" -lt 60 ]; }; then
      warn "驱动 $DRIVER 过低，cu124 需 >=525.60。请升级驱动，或改用 PYTORCH_INDEX_URL=.../cu121。"
    fi
  fi
}

# -----------------------------------------------------------------------------
# 1. 系统依赖
# -----------------------------------------------------------------------------
install_apt() {
  step "安装系统依赖"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y || die "apt-get update 失败"
  apt-get install -y \
    curl wget ca-certificates git build-essential \
    ffmpeg libsndfile1 libsoxr0 \
    python3 python3-venv python3-pip python3-dev \
    libaio1 libnuma1 libncurses6 libtinfo6 \
    openssl || die "apt 安装依赖失败"
  info "系统依赖安装完成"
}

# -----------------------------------------------------------------------------
# 2. Node.js（npm）
# -----------------------------------------------------------------------------
install_node() {
  step "安装 Node.js $NODE_VERSION"
  if have node && [ "$(node -v)" = "v$NODE_VERSION" ]; then
    info "Node 已安装：$(node -v)"
    return 0
  fi
  local tarball="node-v$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSL "$NODE_MIRROR/v$NODE_VERSION/$tarball" -o "/tmp/$tarball" || die "Node 下载失败：$NODE_MIRROR/v$NODE_VERSION/$tarball"
  tar -xJf "/tmp/$tarball" -C /usr/local --strip-components=1 || die "Node 解压失败"
  rm -f "/tmp/$tarball"
  info "Node: $(node -v) / npm: $(npm -v)"
}

# -----------------------------------------------------------------------------
# 3. Miniconda + mss 推理环境
# -----------------------------------------------------------------------------
install_conda_env() {
  step "安装 Miniconda 与 mss 推理环境"

  if [ ! -x "$CONDA_PREFIX/bin/conda" ]; then
    local installer="Miniconda3-py310_24.1.2-0-Linux-x86_64.sh"
    curl -fsSL "$CONDA_MIRROR/miniconda/$installer" -o "/tmp/$installer" || die "Miniconda 下载失败"
    bash "/tmp/$installer" -b -p "$CONDA_PREFIX" || die "Miniconda 安装失败"
    rm -f "/tmp/$installer"
    "$CONDA_PREFIX/bin/conda" config --add channels "$CONDA_MIRROR/pkgs/main"
    "$CONDA_PREFIX/bin/conda" config --add channels "$CONDA_MIRROR/pkgs/free"
    "$CONDA_PREFIX/bin/conda" config --set show_channel_urls yes
  fi

  if [ ! -x "$MSS_PYTHON" ]; then
    "$CONDA_PREFIX/bin/conda" create -y -n "$MSS_ENV_NAME" python=3.10 || die "conda 创建 mss 环境失败"
  fi

  local py="$MSS_PYTHON"
  # 单独从 PyTorch 官方索引装 torch（含 CUDA 运行时依赖），再装其余冻结依赖
  if ! "$py" -c "import torch" >/dev/null 2>&1; then
    info "安装 torch/torchaudio（cu124，约 2.5GB，请耐心等待）"
    "$py" -m pip install --index-url "$PYTORCH_INDEX_URL" torch==2.6.0 torchaudio==2.6.0 || die "torch 安装失败"
  fi
  "$py" -m pip install -i "$PIP_INDEX_URL" -r "$BASE_DIR/deploy/requirements-mss.txt" || die "mss 依赖安装失败"

  if "$py" -c "import torch, librosa, demucs; print('mss env OK, torch', torch.__version__, 'cuda=', torch.cuda.is_available())"; then
    info "mss 推理环境就绪"
  else
    fail "mss 环境校验失败（缺 librosa/demucs/torch）"
    exit 1
  fi
}

# -----------------------------------------------------------------------------
# 4. 拉取仓库
# -----------------------------------------------------------------------------
clone_repo() {
  step "拉取仓库代码"
  if [ -d "$BASE_DIR/.git" ]; then
    info "仓库已存在，跳过 clone（如需更新请手动 git pull）"
    return 0
  fi
  mkdir -p "$(dirname "$BASE_DIR")"

  local ssh_cmd=""
  if [ -n "$GIT_DEPLOY_KEY" ]; then
    mkdir -p /root/.ssh
    cp "$GIT_DEPLOY_KEY" /root/.ssh/audiolab_deploy
    chmod 600 /root/.ssh/audiolab_deploy
    ssh_cmd="ssh -i /root/.ssh/audiolab_deploy -o StrictHostKeyChecking=no -o BatchMode=yes"
  fi

  if GIT_SSH_COMMAND="${ssh_cmd:-ssh -o StrictHostKeyChecking=no}" \
      git clone -b "$GIT_BRANCH" "$GIT_REPO" "$BASE_DIR"; then
    info "仓库已 clone 到 $BASE_DIR"
  else
    fail "git clone 失败（私有仓库需要访问权限）"
    cat <<EOF
  请二选一，然后重跑本脚本：
  1) 把当前服务器的部署私钥拷过来：
       GIT_DEPLOY_KEY=/path/to/key sudo bash install.sh
     或手动：scp 当前服务器 /root/.ssh/id_ed25519 到新服务器 /root/.ssh/ 并 ssh-add。
  2) 在 GitHub 上给新服务器生成一把 deploy key：
       ssh-keygen -t ed25519 -f /root/.ssh/github_deploy
       cat /root/.ssh/github_deploy.pub   # 添加到 https://github.com/WZP358/AudioLab/settings/keys
     然后：GIT_DEPLOY_KEY=/root/.ssh/github_deploy sudo bash install.sh
EOF
    exit 1
  fi
}

# -----------------------------------------------------------------------------
# 5. 下载模型权重
# -----------------------------------------------------------------------------
download_models() {
  step "下载模型权重（约 1.1GB）"
  mkdir -p "$MODELS_DIR"

  dl() { # dl <url> <文件名>
    local url="$1" name="$2" out="$MODELS_DIR/$name"
    if [ -s "$out" ]; then
      info "已存在，跳过：$name"
      return 0
    fi
    info "下载 $name ..."
    curl -fL --retry 3 --retry-delay 5 -C - "$url" -o "$out" \
      || { fail "下载失败：$name（$url）"; rm -f "$out"; return 1; }
  }

  dl "https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.1/model_mdx23c_ep_168_sdr_7.0207.ckpt" "model_mdx23c_ep_168_sdr_7.0207.ckpt" || true
  dl "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th" "955717e8-8726e21a.th" || true
  dl "https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v1.0.12/model_bs_roformer_ep_17_sdr_9.6568.ckpt" "model_bs_roformer_ep_17_sdr_9.6568.ckpt" || true
  dl "https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download/v.1.0.6/scnet_checkpoint_musdb18.ckpt" "scnet_checkpoint_musdb18.ckpt" || true

  local n=$(ls "$MODELS_DIR"/*.ckpt "$MODELS_DIR"/*.th 2>/dev/null | wc -l)
  if [ "$n" -lt 4 ]; then
    warn "当前只有 $n/4 个权重文件（部分下载失败）。缺失的权重对应算法将无法使用，可稍后重跑本脚本补下。"
  else
    info "4 个模型权重就绪"
  fi
}

# -----------------------------------------------------------------------------
# 6. 便携版 MySQL 恢复
# -----------------------------------------------------------------------------
setup_mysql() {
  step "配置数据库（MySQL）"
  if [ ! -f "$MYSQL_TARBALL" ]; then
    # —— 方式 B：无便携包时，改用系统 MySQL(apt) + 导入 SQL 快照 ——
    if [ -f "$DB_SQL" ]; then
      info "未找到便携包 $MYSQL_TARBALL，改用系统 MySQL + SQL 快照：$DB_SQL"
      if ! have mysql; then
        apt-get install -y mysql-server || die "安装 mysql-server 失败"
      fi
      systemctl enable --now mysql 2>/dev/null || service mysql start 2>/dev/null || true
      for i in $(seq 1 30); do mysqladmin ping --silent 2>/dev/null && break; sleep 2; done
      mysqladmin ping --silent 2>/dev/null || { fail "MySQL 启动失败"; die "MySQL 启动失败"; }
      mysql -u root < "$DB_SQL" || die "导入 SQL 快照失败：$DB_SQL"
      info "已导入数据库快照 $DB_SQL"
      DB_PASS=$(grep -oP '(?<=audiolab:)[^@]+' "$BASE_DIR/backend/.env" 2>/dev/null || true)
      if [ -n "$DB_PASS" ]; then
        mysql -u root <<SQL
CREATE DATABASE IF NOT EXISTS audiolab CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'audiolab'@'localhost' IDENTIFIED BY '$DB_PASS';
CREATE USER IF NOT EXISTS 'audiolab'@'127.0.0.1' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON audiolab.* TO 'audiolab'@'localhost';
GRANT ALL PRIVILEGES ON audiolab.* TO 'audiolab'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
        info "MySQL 账号 audiolab 就绪"
      fi
      info "系统 MySQL 已就绪"
      return 0
    fi
    warn "未找到 MySQL 便携包 $MYSQL_TARBALL，也未找到 SQL 快照 $DB_SQL。"
    warn "请在当前服务器生成其一：deploy/pack_mysql.sh（便携包）或导出 audiolab.sql，拷贝到新服务器后重跑本脚本。"
    warn "本次跳过数据库配置（后端将无法连接 DB）。"
    return 0
  fi

  tar -xzf "$MYSQL_TARBALL" -C "$DATA_ROOT"

  export LD_LIBRARY_PATH="$MYSQL_DIR/lib:/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu"
  mkdir -p /var/run/mysqld

  # 首次初始化数据目录
  if [ ! -d "$MYSQL_DATA/mysql" ]; then
    info "初始化 MySQL 数据目录 $MYSQL_DATA ..."
    "$MYSQL_DIR/bin/mysqld" --initialize-insecure --datadir="$MYSQL_DATA" --user=root \
      --basedir="$MYSQL_DIR" --lc-messages-dir="$MYSQL_DIR/share/mysql/english" \
      --character-sets-dir="$MYSQL_DIR/share/mysql/charsets" > /tmp/mysql_init.log 2>&1 \
      || { fail "MySQL 初始化失败，见 /tmp/mysql_init.log"; tail -20 /tmp/mysql_init.log; die "MySQL 初始化失败"; }
  fi

  # 启动（若未运行）
  if ! "$MYSQL_DIR/bin/mysqladmin" ping --silent 2>/dev/null; then
    "$MYSQL_DIR/bin/mysqld" --datadir="$MYSQL_DATA" --basedir="$MYSQL_DIR" \
      --lc-messages-dir="$MYSQL_DIR/share/mysql/english" \
      --character-sets-dir="$MYSQL_DIR/share/mysql/charsets" \
      --user=root --port=3306 --bind-address=127.0.0.1 \
      --socket=/var/run/mysqld/mysqld.sock > /tmp/mysqld_portable.log 2>&1 &
    for i in $(seq 1 30); do
      "$MYSQL_DIR/bin/mysqladmin" ping --silent 2>/dev/null && break
      sleep 2
    done
  fi
  "$MYSQL_DIR/bin/mysqladmin" ping --silent 2>/dev/null || { fail "MySQL 启动失败，见 /tmp/mysqld_portable.log"; tail -25 /tmp/mysqld_portable.log; die "MySQL 启动失败"; }

  # 导入带数据的数据库（dump 内含 CREATE DATABASE / 表 / 数据）
  if [ -f "$DATA_ROOT/audiolab.sql" ]; then
    "$MYSQL_DIR/bin/mysql" -u root --socket=/var/run/mysqld/mysqld.sock < "$DATA_ROOT/audiolab.sql"
    info "已导入数据库快照 audiolab.sql"
  fi

  # 创建/更新 audiolab 账号（密码与 .env 保持一致，见 write_env）
  DB_PASS=$(grep -oP '(?<=audiolab:)[^@]+' "$BASE_DIR/backend/.env" 2>/dev/null || true)
  if [ -n "$DB_PASS" ]; then
    "$MYSQL_DIR/bin/mysql" -u root --socket=/var/run/mysqld/mysqld.sock <<SQL
CREATE DATABASE IF NOT EXISTS audiolab CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'audiolab'@'localhost' IDENTIFIED BY '$DB_PASS';
CREATE USER IF NOT EXISTS 'audiolab'@'127.0.0.1' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON audiolab.* TO 'audiolab'@'localhost';
GRANT ALL PRIVILEGES ON audiolab.* TO 'audiolab'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
    info "MySQL 账号 audiolab 就绪"
  fi
  info "便携版 MySQL 已启动（数据目录 $MYSQL_DATA）"
}

# -----------------------------------------------------------------------------
# 7. 后端 venv
# -----------------------------------------------------------------------------
setup_backend_venv() {
  step "创建后端虚拟环境"
  cd "$BASE_DIR/backend"
  if [ ! -x ".venv/bin/python" ]; then
    python3 -m venv .venv || die "创建后端 venv 失败"
  fi
  .venv/bin/pip install --upgrade pip -i "$PIP_INDEX_URL"
  .venv/bin/pip install -i "$PIP_INDEX_URL" -r requirements.txt || die "后端依赖安装失败"
  info "后端依赖安装完成"
}

# -----------------------------------------------------------------------------
# 8. 生成 .env
# -----------------------------------------------------------------------------
write_env() {
  step "生成 backend/.env"
  cd "$BASE_DIR/backend"
  if [ -f .env ]; then
    info ".env 已存在，跳过（如需重置请删除后重跑）"
    return 0
  fi
  local db_pass jwt_secret
  db_pass=$(openssl rand -hex 16)
  jwt_secret=$(openssl rand -hex 32)

  cat > .env <<EOF
DATABASE_URL=mysql+aiomysql://audiolab:${db_pass}@127.0.0.1:3306/audiolab
JWT_SECRET=${jwt_secret}
SEPARATION_ENGINE=mss
ALLOW_TEST_ENGINES=false
MSS_FORCE_CPU=false
DEBUG_ERRORS=false
CORS_ORIGINS=
UPLOAD_DIR=${BASE_DIR}/backend/uploads
RESULTS_DIR=${BASE_DIR}/backend/results
AUDIO_RESOURCE_DIR=${BASE_DIR}/backend/audio_resources
MSS_ROOT_DIR=${BASE_DIR}/Music-Source-Separation-Training-main
MSS_PYTHON=${MSS_PYTHON}
MSS_MDX23C_CKPT=${MODELS_DIR}/model_mdx23c_ep_168_sdr_7.0207.ckpt
MSS_DEMUCS4HT_CKPT=${MODELS_DIR}/955717e8-8726e21a.th
MSS_BS_ROFORMER_CKPT=${MODELS_DIR}/model_bs_roformer_ep_17_sdr_9.6568.ckpt
MSS_SCNET_CKPT=${MODELS_DIR}/scnet_checkpoint_musdb18.ckpt
GPU_COUNT=${GPU_COUNT}
SEPARATION_WORKERS=${GPU_COUNT}
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_DELIVERY_MODE=mock
MAIL_FROM=
EOF
  chmod 600 .env
  info ".env 已生成（单卡 GPU_COUNT=${GPU_COUNT}）"
}

# -----------------------------------------------------------------------------
# 9. 初始化数据库 / 系统配置 / 默认账号
# -----------------------------------------------------------------------------
init_app() {
  step "初始化数据库与默认账号"
  cd "$BASE_DIR/backend"
  .venv/bin/python -m app.init_db 2>&1 | tail -3 || die "init_db 失败（请确认 MySQL 已启动）"
  .venv/bin/python -m app.init_system_configs 2>&1 | tail -2 || die "init_system_configs 失败"
  .venv/bin/python -m app.create_admin 2>&1 | tail -8 || die "create_admin 失败"
}

# -----------------------------------------------------------------------------
# 10. 构建前端
# -----------------------------------------------------------------------------
build_frontend() {
  step "构建前端"
  cd "$BASE_DIR/frontend"
  if [ ! -d node_modules ]; then
    CI= npm ci 2>&1 | tail -3 || die "npm ci 失败"
  fi
  CI= PUBLIC_URL=/ npm run build 2>&1 | tail -5 || die "前端构建失败"
  [ -f build/index.html ] || die "前端构建产物缺失"
  info "前端构建完成 -> $BASE_DIR/frontend/build"
}

# -----------------------------------------------------------------------------
# 11. 启动后端（看门狗保活）
# -----------------------------------------------------------------------------
start_backend() {
  step "启动后端（看门狗保活）"
  if pgrep -f run_production.py >/dev/null; then
    info "后端已在运行"
  else
    cd "$BASE_DIR"
    nohup bash deploy/start_backend.sh > /tmp/audiolab.log 2>&1 &
    info "后端启动中..."
  fi

  sleep 8
  if curl -s http://127.0.0.1:8000/health 2>/dev/null | grep -q '"ok"'; then
    info "✅ 后端 /health 正常"
  else
    warn "后端健康检查未通过，请查看 /tmp/audiolab.log"
    tail -20 /tmp/audiolab.log 2>/dev/null || true
  fi
}

# -----------------------------------------------------------------------------
# 汇总
# -----------------------------------------------------------------------------
print_summary() {
  local ip
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo
  echo "================================================================"
  echo " 部署完成！"
  echo "   访问地址：http://${ip:-<服务器IP>}:8000"
  echo "   后端日志：/tmp/audiolab.log"
  echo "   默认账号：admin / admin123（其余见 create_admin 输出）"
  echo
  echo "   常用命令："
  echo "     停止后端：  bash $BASE_DIR/deploy/stop_backend.sh"
  echo "     重启后端：  bash $BASE_DIR/deploy/stop_backend.sh && (cd $BASE_DIR && nohup bash deploy/start_backend.sh >/tmp/audiolab.log 2>&1 &)"
  echo "     重启 MySQL：bash $BASE_DIR/deploy/start_mysql.sh"
  echo "========================================================================"
}

# -----------------------------------------------------------------------------
# main
# -----------------------------------------------------------------------------
main() {
  as_root
  detect_env
  install_apt
  install_node
  clone_repo            # 需先有代码，install_conda_env / setup_backend_venv 依赖 requirements 文件
  install_conda_env
  download_models
  write_env              # 先写 .env，供 setup_mysql 读 DB 密码
  setup_mysql
  setup_backend_venv
  init_app
  build_frontend
  start_backend
  print_summary
}

main "$@"
