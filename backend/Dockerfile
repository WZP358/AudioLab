FROM python:3.10-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    default-mysql-client \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt


RUN echo "正在安装 PyTorch (CPU)..." && \
    pip install --no-cache-dir --default-timeout=600 --retries=5 --progress-bar=pretty -v \
        torch \
        torchaudio \
        --index-url https://download.pytorch.org/whl/cpu \
    && echo "✓ PyTorch (CPU) 安装成功" \
    || (echo "✗ 错误: PyTorch (CPU) 安装失败，构建将失败" && exit 1) && \
    python -c "import torch; print(f'✓ PyTorch 版本: {torch.__version__}')" && \
    python -c "import torchaudio; print(f'✓ torchaudio 版本: {torchaudio.__version__}')"

# 安装其他 MSS 核心依赖（包括 matplotlib，MSS inference.py 需要）
RUN pip install --no-cache-dir \
    librosa \
    soundfile \
    scipy \
    numpy \
    tqdm \
    pandas \
    ml_collections \
    matplotlib \
    
    || echo "警告: MSS 核心依赖安装失败，将在运行时安装"

COPY app ./app

# 复制启动脚本并转换换行符（Windows CRLF -> Linux LF）
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/docker-entrypoint.sh"]

