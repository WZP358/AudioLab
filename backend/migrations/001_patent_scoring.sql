-- AudioLab 专利评分增强迁移（MySQL 8.x 兼容版，幂等）
-- 对应：Score 盲化评分字段、BlindSample 15 秒样本、StandardLabel 标准化标签。
SET NAMES utf8mb4;

-- 取消与失败是不同业务结果，保留旧状态并增加 CANCELLED。
SET @status_ddl := IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'separation_tasks' AND COLUMN_NAME = 'status'),
  'ALTER TABLE separation_tasks MODIFY COLUMN status ENUM(''PENDING'',''PROCESSING'',''COMPLETED'',''FAILED'',''CANCELLED'') NULL',
  'SELECT 1'
);
PREPARE status_stmt FROM @status_ddl; EXECUTE status_stmt; DEALLOCATE PREPARE status_stmt;

-- 幂等加列存储过程
DROP PROCEDURE IF EXISTS audiolab_add_column;
DELIMITER $$
CREATE PROCEDURE audiolab_add_column(
  IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
  END IF;
END$$
DELIMITER ;

CALL audiolab_add_column('scores', 'overall_acceptability', 'INT NULL');
CALL audiolab_add_column('blind_samples', 'objective_metrics_json', 'TEXT NULL');
CALL audiolab_add_column('scores', 'blind_sample_id', 'BIGINT NULL');
CALL audiolab_add_column('scores', 'segment_start', 'FLOAT NULL');
CALL audiolab_add_column('scores', 'segment_end', 'FLOAT NULL');
CALL audiolab_add_column('scores', 'issue_tags', 'TEXT NULL');
CALL audiolab_add_column('scores', 'issue_annotations', 'TEXT NULL');
CALL audiolab_add_column('scores', 'reliability', 'INT NULL');
CALL audiolab_add_column('scores', 'updated_at', 'DATETIME NULL');
CALL audiolab_add_column('scores', 'version', 'INT NOT NULL DEFAULT 1');
CALL audiolab_add_column('scores', 'last_modified_by', 'VARCHAR(255) NULL');
CALL audiolab_add_column('scores', 'modification_reason', 'VARCHAR(500) NULL');
CALL audiolab_add_column('scores', 'is_deleted', 'BOOLEAN NOT NULL DEFAULT FALSE');
CALL audiolab_add_column('scores', 'deleted_at', 'DATETIME NULL');
CALL audiolab_add_column('scores', 'deleted_by', 'VARCHAR(255) NULL');
CALL audiolab_add_column('scores', 'delete_reason', 'VARCHAR(500) NULL');
CALL audiolab_add_column('blind_samples', 'sample_group_key', 'VARCHAR(255) NULL');

-- 幂等唯一索引
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'scores'
    AND INDEX_NAME = 'uq_scores_user_blind_sample'
);
SET @ddl := IF(@idx_exists = 0,
  'ALTER TABLE scores ADD UNIQUE INDEX uq_scores_user_blind_sample (user_id, blind_sample_id)',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

DROP PROCEDURE IF EXISTS audiolab_add_column;

CREATE TABLE IF NOT EXISTS blind_samples (
  id BIGINT NOT NULL PRIMARY KEY,
  blind_code VARCHAR(64) NOT NULL,
  task_id BIGINT NOT NULL,
  algorithm ENUM('DEMUCS_V4','SPLEETER','OPENUNMIX','BANDSPLITRNN','MDX23C','DEMUCS4HT','BAND_SPLIT_ROFORMER','SCNET') NOT NULL,
  stem_name VARCHAR(50) NOT NULL,
  start_seconds FLOAT NOT NULL DEFAULT 0,
  end_seconds FLOAT NOT NULL DEFAULT 15,
  file_path VARCHAR(500) NOT NULL,
  objective_metrics_json TEXT NULL,
  sample_group_key VARCHAR(255) NULL,
  experiment_id BIGINT NULL,
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_blind_samples_code (blind_code),
  KEY ix_blind_samples_task (task_id),
  KEY ix_blind_samples_stem (stem_name)
  ,KEY ix_blind_samples_group (sample_group_key)
  ,KEY ix_blind_samples_experiment (experiment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS blind_experiments (
  id BIGINT NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_blind_experiments_creator (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS blind_assignments (
  id BIGINT NOT NULL PRIMARY KEY,
  experiment_id BIGINT NOT NULL,
  blind_sample_id BIGINT NOT NULL,
  expert_id VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'assigned',
  assigned_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  UNIQUE KEY uq_blind_assignment (experiment_id, blind_sample_id, expert_id),
  KEY ix_blind_assignment_expert (expert_id),
  KEY ix_blind_assignment_sample (blind_sample_id)
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
SELECT UUID_SHORT(), 'Vocals', label, TRUE FROM (
  SELECT '音色变薄' label UNION ALL SELECT '齿音异常' UNION ALL SELECT '人声残留' UNION ALL SELECT '伴奏残留'
) t
WHERE NOT EXISTS (SELECT 1 FROM standard_labels s WHERE s.stem_name='Vocals' AND s.label=t.label);

INSERT INTO standard_labels (id, stem_name, label, is_active)
SELECT UUID_SHORT(), 'Drums', label, TRUE FROM (
  SELECT '鼓点瞬态削弱' label UNION ALL SELECT '鼓声起音模糊' UNION ALL SELECT '底鼓低频缺失' UNION ALL SELECT '镲片高频缺失'
) t
WHERE NOT EXISTS (SELECT 1 FROM standard_labels s WHERE s.stem_name='Drums' AND s.label=t.label);

INSERT INTO standard_labels (id, stem_name, label, is_active)
SELECT UUID_SHORT(), 'Bass', label, TRUE FROM (
  SELECT '低频主体缺失' label UNION ALL SELECT '基频能量削弱' UNION ALL SELECT '低频串扰' UNION ALL SELECT '延音不完整'
) t
WHERE NOT EXISTS (SELECT 1 FROM standard_labels s WHERE s.stem_name='Bass' AND s.label=t.label);

INSERT INTO standard_labels (id, stem_name, label, is_active)
SELECT UUID_SHORT(), 'Other', label, TRUE FROM (
  SELECT '其他伴奏残留' label UNION ALL SELECT '混响残留' UNION ALL SELECT '金属感伪影' UNION ALL SELECT '颗粒感伪影'
) t
WHERE NOT EXISTS (SELECT 1 FROM standard_labels s WHERE s.stem_name='Other' AND s.label=t.label);
