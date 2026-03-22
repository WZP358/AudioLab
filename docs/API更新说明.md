# AudioLab API 更新说明

## 更新概览

本次更新包含两个主要改进：

1. **完整 BSS Eval v3 客观指标计算**：按照 Vincent et al. (2006) 标准公式实现
2. **批量主观评分提交**：要求一次性提交所有4个源的评分，避免遗漏

---

## 一、客观指标计算更新

### 1.1 完整公式实现

现在严格按照 BSS Eval v3 标准计算客观指标：

```
估计信号分解：ŝ = s + e_spat + e_interf + e_artif

其中：
- s: 目标源的真实成分
- e_spat: 空间失真（单声道下接近0）
- e_interf: 其他源的干扰
- e_artif: 算法引入的伪影

指标计算：
- SDR = 10 log10(||s||² / ||e_spat + e_interf + e_artif||²)
- SIR = 10 log10(||s + e_spat||² / ||e_interf||²)
- SAR = 10 log10(||s + e_spat + e_interf||² / ||e_artif||²)
- ISR = 10 log10(||s||² / ||e_spat||²)
```

### 1.2 API 接口

#### 批量计算（推荐）

**接口**: `POST /api/tasks/{task_id}/objective-metrics-batch`

**请求示例**:
```bash
curl -X POST "http://localhost:8000/api/tasks/123/objective-metrics-batch" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "vocals_ref=@vocals_reference.wav" \
  -F "drums_ref=@drums_reference.wav" \
  -F "bass_ref=@bass_reference.wav" \
  -F "other_ref=@other_reference.wav"
```

**响应示例**:
```json
{
  "task_id": 123,
  "metrics_by_source": {
    "Vocals": {
      "sdr": 8.5,
      "sir": 12.1,
      "sar": 7.8,
      "isr": 45.2
    },
    "Drums": {
      "sdr": 7.2,
      "sir": 10.5,
      "sar": 8.1,
      "isr": 42.8
    },
    "Bass": {
      "sdr": 6.8,
      "sir": 9.8,
      "sar": 7.5,
      "isr": 41.3
    },
    "Other": {
      "sdr": 5.9,
      "sir": 8.2,
      "sar": 6.7,
      "isr": 38.9
    }
  },
  "average": {
    "sdr": 7.1,
    "sir": 10.15,
    "sar": 7.525
  },
  "comment": "已计算 4 个源的多源分离指标（完整 BSS Eval v3）"
}
```

#### 单源计算（兼容旧版）

**接口**: `POST /api/tasks/{task_id}/objective-metrics?target=Vocals`

保留用于向后兼容，但推荐使用批量接口。

---

## 二、主观评分更新

### 2.1 批量提交（新增，推荐）

**接口**: `POST /api/scores/batch`

**要求**:
- 必须同时提交 Vocals, Drums, Bass, Other 四个源的评分
- 每个源包含三个维度：quality, interference, artifacts（0-100）
- 避免遗漏评分，确保数据完整性

**请求示例**:
```json
{
  "task_id": 123,
  "algorithm": "MDX23C",
  "scores": [
    {
      "stem_name": "Vocals",
      "quality": 85,
      "interference": 78,
      "artifacts": 82
    },
    {
      "stem_name": "Drums",
      "quality": 72,
      "interference": 68,
      "artifacts": 75
    },
    {
      "stem_name": "Bass",
      "quality": 68,
      "interference": 65,
      "artifacts": 70
    },
    {
      "stem_name": "Other",
      "quality": 60,
      "interference": 58,
      "artifacts": 62
    }
  ]
}
```

**响应示例**:
```json
[
  {
    "id": "1234567890",
    "user_id": "expert_001",
    "task_id": "123",
    "algorithm": "MDX23C",
    "stem_name": "Vocals",
    "quality": 85,
    "interference": 78,
    "artifacts": 82,
    "created_at": "2026-03-21T10:30:00Z"
  },
  // ... 其他3个源的评分记录
]
```

**错误处理**:
```json
// 缺少源的评分
{
  "detail": "缺少以下源的评分: Bass, Other"
}

// 重复提交
{
  "detail": "您已经为该任务提交过评分（已评分的源: Vocals, Drums, Bass, Other）。如需修改，请先删除旧评分。"
}
```

### 2.2 单源提交（已弃用）

**接口**: `POST /api/scores`

保留用于向后兼容，但强烈建议使用批量接口。

---

## 三、前端集成指南

### 3.1 客观指标计算

```javascript
// 批量上传金标准并计算指标
async function computeObjectiveMetrics(taskId, referenceFiles) {
  const formData = new FormData();
  formData.append('vocals_ref', referenceFiles.vocals);
  formData.append('drums_ref', referenceFiles.drums);
  formData.append('bass_ref', referenceFiles.bass);
  formData.append('other_ref', referenceFiles.other);

  const response = await fetch(
    `/api/tasks/${taskId}/objective-metrics-batch`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    }
  );

  return await response.json();
}
```

### 3.2 主观评分提交

```javascript
// 批量提交所有源的评分
async function submitScores(taskId, algorithm, scores) {
  // 验证是否包含所有4个源
  const requiredStems = ['Vocals', 'Drums', 'Bass', 'Other'];
  const providedStems = scores.map(s => s.stem_name);
  const missing = requiredStems.filter(s => !providedStems.includes(s));

  if (missing.length > 0) {
    throw new Error(`缺少以下源的评分: ${missing.join(', ')}`);
  }

  const response = await fetch('/api/scores/batch', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      task_id: taskId,
      algorithm: algorithm,
      scores: scores
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail);
  }

  return await response.json();
}

// 使用示例
const scores = [
  { stem_name: 'Vocals', quality: 85, interference: 78, artifacts: 82 },
  { stem_name: 'Drums', quality: 72, interference: 68, artifacts: 75 },
  { stem_name: 'Bass', quality: 68, interference: 65, artifacts: 70 },
  { stem_name: 'Other', quality: 60, interference: 58, artifacts: 62 }
];

await submitScores(123, 'MDX23C', scores);
```

---

## 四、数据库变更

无需数据库迁移，现有表结构已支持新功能。

---

## 五、测试

### 5.1 测试客观指标计算

```bash
cd backend
python test_multisource_metrics.py
```

### 5.2 测试主观评分

```bash
# 测试批量提交
curl -X POST "http://localhost:8000/api/scores/batch" \
  -H "Authorization: Bearer YOUR_EXPERT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": 123,
    "algorithm": "MDX23C",
    "scores": [
      {"stem_name": "Vocals", "quality": 85, "interference": 78, "artifacts": 82},
      {"stem_name": "Drums", "quality": 72, "interference": 68, "artifacts": 75},
      {"stem_name": "Bass", "quality": 68, "interference": 65, "artifacts": 70},
      {"stem_name": "Other", "quality": 60, "interference": 58, "artifacts": 62}
    ]
  }'
```

---

## 六、参考文献

Vincent, E., Gribonval, R., & Févotte, C. (2006).
"Performance measurement in blind audio source separation."
IEEE Transactions on Audio, Speech, and Language Processing, 14(4), 1462-1469.
