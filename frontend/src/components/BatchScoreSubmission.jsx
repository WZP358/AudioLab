/**
 * 批量主观评分组件示例
 *
 * 功能：
 * 1. 一次性展示所有4个源的评分表单
 * 2. 验证所有源都已评分
 * 3. 批量提交到后端
 */

import React, { useState } from 'react';

const REQUIRED_STEMS = ['Vocals', 'Drums', 'Bass', 'Other'];

const SCORE_DIMENSIONS = [
  { key: 'quality', label: '质量 (Quality)', description: '整体分离质量，越高越接近金标准' },
  { key: 'interference', label: '干扰抑制 (Interference)', description: '其他源的串音程度，越高越干净' },
  { key: 'artifacts', label: '伪影抑制 (Artifacts)', description: '算法引入的失真，越高越自然' }
];

export function BatchScoreSubmission({ taskId, algorithm, onSuccess, onError }) {
  const [scores, setScores] = useState(() => {
    // 初始化所有源的评分为50
    return REQUIRED_STEMS.reduce((acc, stem) => {
      acc[stem] = { quality: 50, interference: 50, artifacts: 50 };
      return acc;
    }, {});
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);

  // 检查某个stem是否已完成所有评分
  const isStemComplete = (stemName) => {
    if (!scores[stemName]) return false;
    return SCORE_DIMENSIONS.every(dim => {
      const value = scores[stemName][dim.key];
      return value !== undefined && value !== null && value !== '' &&
             !isNaN(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
    });
  };

  // 计算完成进度
  const completedStems = REQUIRED_STEMS.filter(stem => isStemComplete(stem)).length;
  const totalStems = REQUIRED_STEMS.length;
  const isAllComplete = completedStems === totalStems;

  // 更新单个源的单个维度评分
  const updateScore = (stemName, dimension, value) => {
    setScores(prev => ({
      ...prev,
      [stemName]: {
        ...prev[stemName],
        [dimension]: Math.max(0, Math.min(100, parseInt(value) || 0))
      }
    }));
    setValidationErrors([]);
  };

  // 验证评分完整性
  const validateScores = () => {
    const errors = [];

    REQUIRED_STEMS.forEach(stem => {
      if (!scores[stem]) {
        errors.push(`缺少 ${stem} 的评分`);
        return;
      }

      SCORE_DIMENSIONS.forEach(dim => {
        const value = scores[stem][dim.key];
        if (value === undefined || value === null || value === '') {
          errors.push(`${stem} 的 ${dim.label} 未填写`);
        } else {
          const numValue = Number(value);
          if (isNaN(numValue) || numValue < 0 || numValue > 100) {
            errors.push(`${stem} 的 ${dim.label} 必须在 0-100 之间`);
          }
        }
      });
    });

    return errors;
  };

  // 提交评分
  const handleSubmit = async () => {
    // 验证
    const errors = validateScores();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setIsSubmitting(true);
    setValidationErrors([]);

    try {
      // 转换为 API 格式
      const payload = {
        task_id: taskId,
        algorithm: algorithm,
        scores: REQUIRED_STEMS.map(stem => ({
          stem_name: stem,
          quality: scores[stem].quality,
          interference: scores[stem].interference,
          artifacts: scores[stem].artifacts
        }))
      };

      const response = await fetch('/api/scores/batch', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || '提交失败');
      }

      const result = await response.json();
      onSuccess?.(result);
    } catch (error) {
      console.error('提交评分失败:', error);
      onError?.(error.message);
      setValidationErrors([error.message]);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="batch-score-submission">
      <div className="header">
        <h3>主观评分提交</h3>
        <p className="description">
          请为所有4个源（Vocals, Drums, Bass, Other）的分离结果进行评分。
          每个源包含3个维度，评分范围 0-100。
        </p>
        <div className="progress-indicator">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(completedStems / totalStems) * 100}%` }}
            ></div>
          </div>
          <p className="progress-text">
            已完成 {completedStems} / {totalStems} 个声源的评分
            {isAllComplete && <span className="complete-badge">✓ 全部完成</span>}
          </p>
        </div>
      </div>

      {/* 验证错误提示 */}
      {validationErrors.length > 0 && (
        <div className="validation-errors">
          <strong>请修正以下问题：</strong>
          <ul>
            {validationErrors.map((error, idx) => (
              <li key={idx}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 评分表单 */}
      <div className="score-forms">
        {REQUIRED_STEMS.map(stem => {
          const isComplete = isStemComplete(stem);
          return (
            <div key={stem} className={`stem-score-card ${isComplete ? 'complete' : 'incomplete'}`}>
              <div className="stem-header">
                <h4>{stem}</h4>
                {isComplete && <span className="complete-icon">✓</span>}
              </div>

            {SCORE_DIMENSIONS.map(dim => (
              <div key={dim.key} className="score-dimension">
                <label>
                  <span className="label-text">{dim.label}</span>
                  <span className="label-desc">{dim.description}</span>
                </label>

                <div className="score-input-group">
                  {/* 滑块 */}
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={scores[stem]?.[dim.key] || 50}
                    onChange={(e) => updateScore(stem, dim.key, e.target.value)}
                    className="score-slider"
                  />

                  {/* 数值输入 */}
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={scores[stem]?.[dim.key] || 50}
                    onChange={(e) => updateScore(stem, dim.key, e.target.value)}
                    className="score-number"
                  />
                </div>
              </div>
            ))}
          </div>
          );
        })}
      </div>

      {/* 提交按钮 */}
      <div className="submit-section">
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !isAllComplete}
          className="submit-button"
        >
          {isSubmitting ? '提交中...' : isAllComplete ? '提交所有评分' : `请完成所有评分 (${completedStems}/${totalStems})`}
        </button>

        <p className="submit-hint">
          {isAllComplete
            ? `提交后将创建 ${REQUIRED_STEMS.length} 条评分记录`
            : `还需完成 ${totalStems - completedStems} 个声源的评分`
          }
        </p>
      </div>

      <style jsx>{`
        .batch-score-submission {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
        }

        .header {
          margin-bottom: 30px;
        }

        .header h3 {
          font-size: 24px;
          margin-bottom: 10px;
        }

        .description {
          color: #666;
          line-height: 1.6;
        }

        .progress-indicator {
          margin-top: 20px;
        }

        .progress-bar {
          width: 100%;
          height: 8px;
          background: #e0e0e0;
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 8px;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #4CAF50, #45a049);
          transition: width 0.3s ease;
        }

        .progress-text {
          font-size: 14px;
          color: #555;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .complete-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          background: #4CAF50;
          color: white;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }

        .validation-errors {
          background: #fee;
          border: 1px solid #fcc;
          border-radius: 8px;
          padding: 15px;
          margin-bottom: 20px;
        }

        .validation-errors ul {
          margin: 10px 0 0 20px;
        }

        .validation-errors li {
          color: #c00;
          margin: 5px 0;
        }

        .score-forms {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }

        .stem-score-card {
          background: #f9f9f9;
          border: 1px solid #ddd;
          border-radius: 12px;
          padding: 20px;
          transition: all 0.3s ease;
        }

        .stem-score-card.complete {
          border-color: #4CAF50;
          background: #f1f8f4;
        }

        .stem-score-card.incomplete {
          border-color: #ff9800;
          background: #fff8f0;
        }

        .stem-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 15px;
          padding-bottom: 8px;
          border-bottom: 2px solid;
        }

        .stem-score-card.complete .stem-header {
          border-bottom-color: #4CAF50;
        }

        .stem-score-card.incomplete .stem-header {
          border-bottom-color: #ff9800;
        }

        .stem-score-card h4 {
          font-size: 18px;
          color: #333;
          margin: 0;
        }

        .complete-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          background: #4CAF50;
          color: white;
          border-radius: 50%;
          font-size: 14px;
          font-weight: bold;
        }

        .score-dimension {
          margin-bottom: 20px;
        }

        .score-dimension label {
          display: block;
          margin-bottom: 8px;
        }

        .label-text {
          display: block;
          font-weight: 600;
          color: #333;
          margin-bottom: 4px;
        }

        .label-desc {
          display: block;
          font-size: 12px;
          color: #666;
        }

        .score-input-group {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .score-slider {
          flex: 1;
          height: 6px;
          border-radius: 3px;
          outline: none;
          -webkit-appearance: none;
          background: #ddd;
        }

        .score-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #4CAF50;
          cursor: pointer;
        }

        .score-number {
          width: 60px;
          padding: 6px;
          border: 1px solid #ddd;
          border-radius: 4px;
          text-align: center;
          font-size: 14px;
        }

        .submit-section {
          text-align: center;
          padding: 20px;
          background: #f5f5f5;
          border-radius: 8px;
        }

        .submit-button {
          background: #4CAF50;
          color: white;
          border: none;
          padding: 12px 40px;
          font-size: 16px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.3s;
        }

        .submit-button:hover:not(:disabled) {
          background: #45a049;
        }

        .submit-button:disabled {
          background: #ccc;
          cursor: not-allowed;
        }

        .submit-hint {
          margin-top: 10px;
          font-size: 13px;
          color: #666;
        }
      `}</style>
    </div>
  );
}

// 使用示例
export function ExampleUsage() {
  return (
    <BatchScoreSubmission
      taskId={123}
      algorithm="MDX23C"
      onSuccess={(result) => {
        console.log('评分提交成功:', result);
        alert(`成功提交 ${result.length} 条评分记录`);
      }}
      onError={(error) => {
        console.error('评分提交失败:', error);
        alert(`提交失败: ${error}`);
      }}
    />
  );
}
