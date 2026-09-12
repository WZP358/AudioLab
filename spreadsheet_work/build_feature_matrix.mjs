import fs from "node:fs/promises";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const outputDir = "D:/code/AudioLab/outputs/feature_review";
await fs.mkdir(outputDir, { recursive: true });

const wb = Workbook.create();
const main = wb.worksheets.add("三级功能核对表");
const notes = wb.worksheets.add("判定说明");
main.showGridLines = false;
notes.showGridLines = false;
main.tabColor = "#1F4E78";
notes.tabColor = "#7F8C8D";

const headers = [
  "一级模块", "二级功能", "三级验收点", "当前状态", "是否满足老师要求", "代码/接口证据", "实际缺口", "验收方式", "优先级", "备注"
];
const rows = [
  ["实验片段", "15秒片段生成", "从已完成分离任务生成固定15秒WAV", "已完成", "是（基础）", "blind_samples.py: _write_15_second_clip; test_patent_integrity.py", "目前是管理员手动触发，不是完整实验批次流程", "生成后用ffprobe检查时长=15秒", "P0", "已通过现有测试"],
  ["实验片段", "15秒片段生成", "同一时间片同时关联Mixture、Gold和四种算法结果", "部分完成", "否", "BlindSample关联task/stem；未见统一clip实体", "缺少片段级实验实体和完整关联", "随机抽一片段检查四类结果及Gold是否一一对应", "P0", "正式实验必须可追溯"],
  ["实验片段", "片段抽样", "按实验方案随机抽样并记录随机种子", "未完成", "否", "生成逻辑按0、15、30秒顺序切片", "没有随机抽样、随机种子和可复现记录", "重复生成或查看实验记录，确认顺序和seed可复现", "P1", "电话中未强制随机，但双盲实验建议具备"],
  ["盲化评分", "算法隐藏", "专家端不显示算法名称、任务ID、原文件名", "部分完成", "否", "blind_samples.py: list_blind_samples不返回映射字段", "专家普通工作台仍显示算法和当前分离结果", "专家登录后逐页检查DOM、截图和接口响应", "P0", "需独立盲化评分页面"],
  ["盲化评分", "盲化分配", "每位专家按随机顺序获得盲化样本", "未完成", "否", "盲化编号使用secrets生成", "没有按专家分配、随机顺序和分配记录", "用两名专家账号检查样本顺序和分配表", "P0", "随机编号不等于随机分配"],
  ["盲化评分", "防重复评分", "同一专家不能重复提交同一盲化样本", "已完成", "是", "blind_samples.py: user_id+blind_sample_id唯一约束及409校验", "需补前端已完成状态和管理员复核提示", "重复提交同一盲化编号，确认返回409且无新增记录", "P1", "基础逻辑已有"],
  ["盲化评分", "目标声源", "专家可以知道目标声源，但不能推断算法", "部分完成", "待确认", "接口返回stem_name；前端显示声源", "样本编号、顺序和页面信息仍需检查是否泄漏来源", "检查盲化页面仅显示声源类型和盲化编号", "P1", "声源信息本身不应隐藏"],
  ["专家评分", "分维度评分", "质量、干扰抑制、伪影控制分别评分", "已完成", "是", "StemScoreData及前端评分控件", "评分尺度与专利文档1-5分不一致", "专家填写三项后检查入库和导出", "P0", "当前系统实际为0-100"],
  ["专家评分", "整体可接受度", "对每个15秒片段填写整体可接受度", "已完成", "是", "overall_acceptability字段及前端控件", "需统一1-5或0-100口径", "填写后检查导出列和统计结果", "P0", "不能与三项维度混淆"],
  ["专家评分", "评分量表", "系统量表与专利、实验记录、导出文件保持一致", "未完成", "否", "专利S33写1-5；schemas.py限制0-100", "材料和系统存在口径冲突", "核对前端、Schema、CSV、说明书四处定义", "P0", "建议专家输入1-5，统计再归一化"],
  ["问题标注", "标准标签", "按Vocals、Drums、Bass、Other维护标准标签", "已完成", "是（基础）", "standard-labels接口；SystemManagement标签库", "需由老师确认标签内容和术语", "管理员增删改查，专家按声源查看标签", "P1", "功能已有，内容需确认"],
  ["问题标注", "问题时间", "问题开始和结束时间限制在0-15秒且开始早于结束", "已完成", "是", "schemas.py校验；前端number输入", "当前一条评分只有一组时间范围", "提交0、15.1、反向区间测试", "P1", "已有9项完整性测试覆盖"],
  ["问题标注", "多问题标注", "同一声源可分别记录多个标签、多个起止时间和备注", "未完成", "否", "当前issue_tags数组与单组segment_start/end", "多个问题共用同一时间段，无法逐条定位", "在同一片段记录3个问题并导出3条明细", "P0", "建议独立issue_annotations表"],
  ["问题标注", "自定义标签", "自定义标签与标准标签分开统计和导出", "部分完成", "待确认", "前端允许回车添加自定义标签；后端统一存issue_tags", "没有tag_type，无法区分标准/自定义", "分别选择和输入标签，检查导出字段", "P1", "建议增加tag_type"],
  ["专家评分", "主观可靠性", "专家填写本次判断的可靠性并限制范围", "已完成", "是（基础）", "reliability字段、前端滑块、Schema范围校验", "可靠性定义和统计用途尚未明确", "提交0、100、101并检查结果", "P1", "当前为0-100"],
  ["专家评分", "多轨试听", "Mixture、Gold、目标Stem同步播放和统一时间轴", "已完成", "是（基础）", "App.js syncedCurrentTime、seekAll、StemPlayer", "需用真实音频现场确认所有轨道同步", "播放、暂停、跳转时比较三路时间", "P1", "代码已有同步机制"],
  ["专家评分", "局部循环", "框选问题区间后支持局部循环试听", "未完成", "否", "未发现明确loop/局部循环状态或控制逻辑", "电话和对照页S33明确要求，但当前缺失", "框选2-3秒并连续循环播放", "P0", "必须补"],
  ["专家评分", "提交方式", "一次性提交同一片段四个Stem的评分，或有清晰进度", "部分完成", "待确认", "后端有ScoreCreateBatch；前端按钮提交当前Stem", "前后端批量能力未接通，容易漏评", "填写一个片段四个Stem，确认一次提交或进度完整", "P1", "建议显示4/4进度"],
  ["客观评估", "指标计算", "计算SDR、SIR、SAR、SI-SDR", "已完成", "是（基础）", "tasks.py objective-metrics及batch接口", "需要确认每个片段、每个声源都实际写入", "用同一片段和Gold检查四项指标", "P0", "接口能力已有"],
  ["客观评估", "片段级明细", "四算法×每片段×每声源均有客观指标明细", "部分完成", "否", "任务级指标和算法聚合统计接口", "当前导出主要是算法聚合，不是完整明细矩阵", "检查导出行数=片段数×算法数×声源数", "P0", "老师明确提出"],
  ["客观评估", "重复推理", "同一片段多次推理并保存均值、标准差或区间", "未完成", "否", "文档S23/S24有描述；未发现完整重复推理记录", "无法证明误差区间来自真实重复实验", "重复运行同片段并检查原始样本与区间", "P1", "如专利继续保留该描述需实现"],
  ["客观评估", "可靠性编码", "按误差区间显示高、中、低可靠性并可导出", "部分完成", "待确认", "文档S24/S25有描述；代码中未确认完整UI闭环", "需检查前端颜色编码和导出字段", "构造高/中/低区间样本查看颜色和CSV", "P1", "不要只在文档中描述"],
  ["数据导出", "主观评分CSV", "管理员导出所有专家的逐条主观评分", "已完成", "是", "scores.py /api/scores/export；AdminApproval导出按钮", "需确认多问题标注改造后仍逐条导出", "导出后核对专家、片段、Stem、维度、标签和时间", "P0", "基础导出已有"],
  ["数据导出", "客观明细CSV", "管理员导出四算法所有片段和声源的SDR等明细", "部分完成", "否", "tasks.py /stats/objective/export", "当前接口按算法聚合，且入口主要在统计页", "导出后逐行核对片段、算法、Stem和指标", "P0", "需要新增实验数据包导出"],
  ["数据导出", "完整实验包", "一次导出主观、客观、盲化映射、模型版本和元数据", "部分完成", "待确认", "tasks.py /stats/export-package包含部分客观/显著性/版本", "未确认包含逐条主观、盲化映射和片段明细", "解压ZIP检查文件清单和关联键", "P1", "建议固定CSV字段和版本"],
  ["数据导出", "数据权限", "专家不能导出或读取真实算法映射，管理员可查看", "部分完成", "否", "blind_samples.py区分普通列表和admin/mapping", "部分客观导出接口未见管理员鉴权，需复核权限边界", "专家Token访问所有导出接口，确认不得到映射和管理数据", "P0", "这是业务权限问题"],
  ["多专家质量", "一致性检验", "计算多专家评分一致性并按阈值提示重评", "未完成", "否", "专利S51描述Kendall；代码未发现实现", "没有Kendall和谐系数及重评分流程", "准备同片段多专家数据，核对系数和提示", "P1", "文档权利要求涉及"],
  ["多专家质量", "异常值处理", "标记异常值并计算有效评分均值，不删除原始数据", "未完成", "否", "专利S52描述2倍标准差；代码未发现实现", "没有outlier标记、纳入最终均值和审计记录", "构造极端评分，核对原始/有效/最终三组数据", "P1", "建议先标记再人工确认"],
  ["模型优化", "主观反馈入训", "按声源和问题时间生成加权损失并触发增量训练", "未完成", "否", "当前主要保存、统计和导出评分", "未形成评分到训练的闭环", "用一批真实评分生成训练配置并保存新模型版本", "P2", "若专利保留S4需补证据"],
  ["实验管理", "真实数据", "三位专家对真实片段试听并产生真实评分", "未完成", "否", "当前无真实实验数据可验证", "不能用随机数据替代真实评分", "三位专家完成同一实验批次并检查覆盖率", "P0", "电话中明确要求真实数据"],
  ["实验管理", "覆盖率检查", "所有目标片段、算法、声源达到预设评分数量后才允许导出结论", "未完成", "否", "未发现完整覆盖率门禁", "可能出现漏评、单算法样本不足却可导出", "缺少任一组合时导出应提示未完成", "P1", "建议管理员看板化"],
  ["版本与追溯", "模型版本", "每条客观数据记录算法版本、参数和生成时间", "部分完成", "待确认", "导出包有model_versions；任务字段需核对", "未确认指标明细与模型版本逐条关联", "更换版本后检查导出是否可区分", "P1", "专利实验需要可复现"],
  ["交付验证", "线上部署", "线上页面加载本次最新构建而不是旧静态文件", "未完成", "否", "线上曾加载main.31a4256e.js，本地最新构建已变化", "SSH主机名无法解析，尚未部署线上", "比较线上和本地index.html的main.js哈希", "P0", "代码完成不等于线上完成"],
];

main.getRangeByIndexes(0, 0, 1, 10).values = [["AudioLab 专利项目三级功能核对表"]];
main.mergeCells("A1:J1");
main.getRange("A2:J2").values = [["用途：按老师电话中的四项补充要求及对照页文档逐项验收。状态基于当前代码、接口和现有测试，不代表真实专家实验已经完成。"]];
main.mergeCells("A2:J2");
main.getRange("A4:J4").values = [headers];
main.getRangeByIndexes(4, 0, rows.length, 10).values = rows;

main.getRange("A1:J1").format = { font: { name: "Arial", size: 15, bold: true, color: "#1F2937" }, rowHeight: 28 };
main.getRange("A2:J2").format = { font: { name: "Arial", size: 10, italic: true, color: "#475569" }, rowHeight: 24, wrapText: true };
main.getRange("A4:J4").format = { fill: "#1F4E78", font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, rowHeight: 30, borders: { preset: "all", style: "thin", color: "#D9E2F3" } };
main.getRangeByIndexes(4, 0, rows.length, 10).format = { font: { name: "Arial", size: 9, color: "#1F2937" }, verticalAlignment: "center", wrapText: true, borders: { preset: "all", style: "thin", color: "#D9D9D9" } };
main.getRange(`A5:J${rows.length + 4}`).format.rowHeight = 42;
main.getRange(`A5:A${rows.length + 4}`).format.font = { name: "Arial", size: 9, bold: true, color: "#1F4E78" };
main.getRange(`D5:E${rows.length + 4}`).format.horizontalAlignment = "center";
main.getRange(`I5:I${rows.length + 4}`).format.horizontalAlignment = "center";
main.getRange("A:A").format.columnWidth = 14;
main.getRange("B:B").format.columnWidth = 16;
main.getRange("C:C").format.columnWidth = 34;
main.getRange("D:E").format.columnWidth = 13;
main.getRange("F:F").format.columnWidth = 34;
main.getRange("G:G").format.columnWidth = 34;
main.getRange("H:H").format.columnWidth = 28;
main.getRange("I:I").format.columnWidth = 9;
main.getRange("J:J").format.columnWidth = 24;
main.freezePanes.freezeRows(4);
main.freezePanes.freezeColumns(3);
main.tables.add(`A4:J${rows.length + 4}`, true, "FeatureAcceptanceTable");
main.getRange(`D5:D${rows.length + 4}`).conditionalFormats.add("containsText", { text: "已完成", format: { fill: "#DCFCE7", font: { color: "#166534", bold: true } } });
main.getRange(`D5:D${rows.length + 4}`).conditionalFormats.add("containsText", { text: "部分完成", format: { fill: "#FEF3C7", font: { color: "#92400E", bold: true } } });
main.getRange(`D5:D${rows.length + 4}`).conditionalFormats.add("containsText", { text: "未完成", format: { fill: "#FEE2E2", font: { color: "#991B1B", bold: true } } });
main.getRange(`E5:E${rows.length + 4}`).conditionalFormats.add("containsText", { text: "否", format: { fill: "#FEE2E2", font: { color: "#991B1B", bold: true } } });

notes.getRange("A1:D1").values = [["判定说明", "定义", "当前数量", "使用方式"]];
notes.getRange("A2:D7").values = [
  ["已完成", "代码、接口、前端入口和基础测试能够证明功能已存在", "", "可以进入现场验收，但仍需用真实数据验证"],
  ["部分完成", "有局部实现，但业务流程、权限、明细或前后端衔接不完整", "", "不能直接对老师宣称完整完成"],
  ["未完成", "没有可运行实现，或只有专利文字/接口雏形而无闭环", "", "必须补功能或调整专利表述"],
  ["是", "满足电话中对应的最低功能要求", "", "通过现场验收后才可作为已交付项"],
  ["否", "不能满足电话中对应要求", "", "优先处理P0项"],
  ["P0", "影响双盲实验、真实数据、片段明细导出或线上交付", "", "重新提交或实验前必须完成"],
];
notes.getRange("C2:C7").formulas = [["=COUNTIF('三级功能核对表'!D5:D100,\"已完成\")"],["=COUNTIF('三级功能核对表'!D5:D100,\"部分完成\")"],["=COUNTIF('三级功能核对表'!D5:D100,\"未完成\")"],["=COUNTIF('三级功能核对表'!E5:E100,\"是*\")"],["=COUNTIF('三级功能核对表'!E5:E100,\"否\")"],["=COUNTIF('三级功能核对表'!I5:I100,\"P0\")"]];
notes.getRange("A9:D9").values = [["本次核对结论", "当前项目可以证明若干基础能力，但严格双盲、片段级客观明细、局部循环、多问题标注、多专家质量控制和真实三专家数据仍未形成完整闭环。", "", ""]];
notes.mergeCells("B9:D9");
notes.getRange("A1:D1").format = { fill: "#1F4E78", font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, borders: { preset: "all", style: "thin", color: "#D9E2F3" } };
notes.getRange("A2:D7").format = { font: { name: "Arial", size: 10, color: "#1F2937" }, verticalAlignment: "center", wrapText: true, borders: { preset: "all", style: "thin", color: "#D9D9D9" } };
notes.getRange("A9:D9").format = { fill: "#FFF7ED", font: { name: "Arial", size: 10, bold: true, color: "#9A3412" }, verticalAlignment: "center", wrapText: true, borders: { preset: "all", style: "thin", color: "#FDBA74" }, rowHeight: 48 };
notes.getRange("A:A").format.columnWidth = 16;
notes.getRange("B:B").format.columnWidth = 54;
notes.getRange("C:C").format.columnWidth = 14;
notes.getRange("D:D").format.columnWidth = 34;
notes.freezePanes.freezeRows(1);

wb.recalculate();
const check = await wb.inspect({ kind: "table", range: "三级功能核对表!A1:J12", include: "values,formulas", tableMaxRows: 12, tableMaxCols: 10, maxChars: 8000 });
console.log(check.ndjson);
const preview = await wb.render({ sheetName: "三级功能核对表", range: "A1:J16", scale: 1, format: "png" });
await fs.writeFile(`${outputDir}/三级功能核对表预览.png`, new Uint8Array(await preview.arrayBuffer()));
const xlsx = await SpreadsheetFile.exportXlsx(wb);
await xlsx.save(`${outputDir}/AudioLab_三级功能核对表.xlsx`);
console.log(`SAVED ${outputDir}/AudioLab_三级功能核对表.xlsx`);
