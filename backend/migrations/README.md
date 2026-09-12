# AudioLab 数据库迁移

数据库使用 MySQL。生产环境部署前执行：

```bash
mysql -u audiolab -p audiolab < migrations/001_patent_scoring.sql
```

`001_patent_scoring.sql` 是盲化评分、15 秒样本和标准化标签功能所需的结构迁移，按 MySQL 8.x 的 `IF NOT EXISTS` 语法编写，可在全新库或已有旧库重复执行。

全新数据库仍建议先运行 `python -m app.init_db`，它会根据 SQLAlchemy 模型创建基础表；随后执行本目录中的版本 SQL，确保结构与现有项目一致。
