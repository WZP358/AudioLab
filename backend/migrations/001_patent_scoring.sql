-- AudioLab 专利评分增强迁移（MySQL 8.x）
-- 对应：Score 盲化评分字段、BlindSample 15 秒样本、StandardLabel 标准化标签。
SET NAMES utf8mb4;

ALTER TABLE scores ADD COLUMN IF NOT EXISTS overall_acceptability INT NULL;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS blind_sample_id BIGINT NULL;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS segment_start FLOAT NULL;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS segment_end FLOAT NULL;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS issue_tags TEXT NULL;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS reliability INT NULL;
ALTER TABLE scores ADD UNIQUE KEY IF NOT EXISTS uq_scores_user_blind_sample (user_id, blind_sample_id);

CREATE TABLE IF NOT EXISTS blind_samples (
  id BIGINT NOT NULL PRIMARY KEY,
  blind_code VARCHAR(64) NOT NULL,
  task_id BIGINT NOT NULL,
  algorithm ENUM('Demucs v4','Spleeter','OpenUnmix','BandSplitRNN','MDX23C','Demucs4HT','Band Split RoFormer','SCNet') NOT NULL,
  stem_name VARCHAR(50) NOT NULL,
  start_seconds FLOAT NOT NULL DEFAULT 0,
  end_seconds FLOAT NOT NULL DEFAULT 15,
  file_path VARCHAR(500) NOT NULL,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_blind_samples_code (blind_code),
  KEY ix_blind_samples_task (task_id),
  KEY ix_blind_samples_stem (stem_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS standard_labels (
  id BIGINT NOT NULL PRIMARY KEY,
  stem_name VARCHAR(50) NOT NULL,
  label VARCHAR(100) NOT NULL,
  description VARCHAR(500) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  KEY ix_standard_labels_stem (stem_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO standard_labels (id, stem_name, label, is_active)
SELECT UUID_SHORT(), 'Vocals', '音色变薄', TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM standard_labels WHERE stem_name='Vocals' AND label='音色变薄');
INSERT INTO standard_labels (id, stem_name, label, is_active)
SELECT UUID_SHORT(), 'Vocals', '齿音异常', TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM standard_labels WHERE stem_name='Vocals' AND label='齿音异常');
INSERT INTO standard_labels (id, stem_name, label, is_active)
SELECT UUID_SHORT(), 'Vocals', '人声残留', TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM standard_labels WHERE stem_name='Vocals' AND label='人声残留');
INSERT INTO standard_labels (id, stem_name, label, is_active)
SELECT UUID_SHORT(), 'Vocals', '伴奏残留', TRUE FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM standard_labels WHERE stem_name='Vocals' AND label='伴奏残留');

INSERT INTO standard_labels (id, stem_name, label, is_active)
SELECT UUID_SHORT(), 'Drums', label, TRUE FROM (SELECT '鼓点瞬态削弱' label UNION ALL SELECT '鼓声起音模糊' UNION ALL SELECT '底鼓低频缺失' UNION ALL SELECT '镲片高频缺失') labels
WHERE NOT EXISTS (SELECT 1 FROM standard_labels s WHERE s.stem_name='Drums' AND s.label=labels.label);
INSERT INTO standard_labels (id, stem_name, label, is_active)
SELECT UUID_SHORT(), 'Bass', label, TRUE FROM (SELECT '低频主体缺失' label UNION ALL SELECT '基频能量削弱' UNION ALL SELECT '低频串扰' UNION ALL SELECT '延音不完整') labels
WHERE NOT EXISTS (SELECT 1 FROM standard_labels s WHERE s.stem_name='Bass' AND s.label=labels.label);
INSERT INTO standard_labels (id, stem_name, label, is_active)
SELECT UUID_SHORT(), 'Other', label, TRUE FROM (SELECT '其他伴奏残留' label UNION ALL SELECT '混响残留' UNION ALL SELECT '金属感伪影' UNION ALL SELECT '颗粒感伪影') labels
WHERE NOT EXISTS (SELECT 1 FROM standard_labels s WHERE s.stem_name='Other' AND s.label=labels.label);
