// 生成 AudioLab 专利申报的5份文档
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat, TabStopType, TabStopPosition
} = require('docx');

const BASE = 'D:\\code\\AudioLab\\专利';

// ========== 通用样式 ==========
const FONT = '宋体';
const FONT_EN = 'Times New Roman';
const PAGE_MARGIN = { top: 1440, right: 850, bottom: 850, left: 1440 }; // 左/顶部25mm, 右/底部15mm (1mm≈56.7twips)
const PAGE_SIZE = { width: 11906, height: 16838 }; // A4

function chineseParagraph(text, options = {}) {
  const { bold, fontSize = 24, alignment = AlignmentType.JUSTIFIED, spacing, firstLine = true } = options;
  return new Paragraph({
    alignment,
    spacing: spacing || { before: 60, after: 60, line: 360 },
    indent: firstLine ? { firstLine: 480 } : undefined,
    children: [new TextRun({ text, font: FONT, size: fontSize, bold: bold || false })],
  });
}

function headingParagraph(text, level) {
  return new Paragraph({
    heading: level,
    spacing: { before: 120, after: 120, line: 360 },
    children: [new TextRun({ text, font: '黑体', size: level === HeadingLevel.HEADING_1 ? 32 : 28, bold: true })],
  });
}

function sectionTitle(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 60, after: 60, line: 360 },
    children: [new TextRun({ text, font: '黑体', size: 28, bold: true })],
  });
}

const border = { style: BorderStyle.SINGLE, size: 1, color: '000000' };
const borders = { top: border, bottom: border, left: border, right: border };

function cell(text, width, options = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    shading: options.shading ? { fill: options.shading, type: ShadingType.CLEAR } : undefined,
    verticalAlign: 'center',
    children: [new Paragraph({
      alignment: options.center ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { before: 20, after: 20 },
      children: [new TextRun({ text, font: FONT, size: 21, bold: options.bold || false })],
    })],
  });
}

// ============================================================
// 文档一：说明书 (100002说明书.docx)
// ============================================================
async function createSpecification() {
  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONT, size: 24 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 32, bold: true, font: '黑体' },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: '黑体' },
          paragraph: { spacing: { before: 180, after: 120 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 26, bold: true, font: '黑体' },
          paragraph: { spacing: { before: 120, after: 60 }, outlineLevel: 2 } },
      ],
    },
    numbering: {
      config: [
        { reference: 'claims', levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        ]},
        { reference: 'bullets', levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        ]},
      ],
    },
    sections: [{
      properties: { page: { size: PAGE_SIZE, margin: PAGE_MARGIN } },
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '说明书', font: FONT, size: 18, color: '888888' })],
        })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '第 ', font: FONT, size: 18 }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 }), new TextRun({ text: ' 页', font: FONT, size: 18 })],
        })] }),
      },
      children: [
        // ===== 发明名称 =====
        new Paragraph({ spacing: { before: 600, after: 120 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 360 },
          children: [new TextRun({ text: '一种面向音乐源分离的主客观协同评估方法及系统', font: '黑体', size: 32, bold: true })],
        }),

        // ===== 技术领域 =====
        headingParagraph('技术领域', HeadingLevel.HEADING_1),
        chineseParagraph('本发明涉及音频信号处理与深度学习技术领域，具体涉及一种面向音乐源分离（Music Source Separation, MSS）任务的主客观协同评估方法及系统，用于对多种音乐源分离算法进行统一的客观指标计算、主观评价管理以及主客观关联分析。'),

        // ===== 背景技术 =====
        headingParagraph('背景技术', HeadingLevel.HEADING_1),
        chineseParagraph('音乐源分离旨在将混合音频分解为若干独立的语义声部（如人声Vocals、鼓Drums、贝斯Bass、其他伴奏Other），广泛应用于智能编曲、音频编辑、音乐信息检索和音乐教育等领域。近年来，基于深度学习的音乐源分离方法在公开数据集上的客观指标（如SDR、SI-SDR等）持续提升，但在实际应用中仍存在"指标数值高但听感不佳"的问题：同一模型在不同曲风、不同编配密度下常出现声部泄漏（source leakage）、瞬态响应模糊（transient smearing）或高频伪影（high-frequency artifacts）等感知质量问题。由此可见，单一依赖客观指标难以全面评估算法模型的实际性能。'),
        chineseParagraph('目前，围绕音乐源分离的评测，国内外存在多类系统与工具，但均存在不同程度的不足：'),
        chineseParagraph('（1）面向终端用户的在线分离平台（如LALAL.AI、Moises、MVSEP等）主要面向消费级应用场景，提供一键式分离服务，但缺乏统一的评测标准与实验可复现机制，不支持多算法的系统化对比分析及主观评价研究。'),
        chineseParagraph('（2）开源分离工具与模型库（如Spleeter、Demucs、Open-Unmix等）主要为研究者提供模型实现和推理接口，具备较强的灵活性和可扩展性，但其主要聚焦算法层面，缺乏统一的任务管理与实验组织能力，难以将主观听感评价纳入标准化评测流程。'),
        chineseParagraph('（3）学术评测工具包（如museval、mir_eval等）虽然实现规范、结果可复现，但通常缺乏可视化界面及多用户协作机制，尤其不支持主观评价数据的结构化采集与分析。'),
        chineseParagraph('综上所述，现有系统在多模型统一管理、主客观评估融合以及评测流程可复现性等方面仍存在不足，难以支撑对"模型性能—感知质量"关系的系统性分析。因此，有必要构建一个集成多模型对比、客观指标自动计算与主观评价协同分析的统一评测平台。'),

        // ===== 发明内容 =====
        headingParagraph('发明内容', HeadingLevel.HEADING_1),
        headingParagraph('发明目的', HeadingLevel.HEADING_2),
        chineseParagraph('本发明旨在解决现有技术中音乐源分离评估存在的以下三个问题：（1）实验数据分散存储、缺乏统一管理；（2）客观指标计算与主观听感评价相互割裂，难以全面衡量算法性能；（3）评估结果缺乏有效的可视化分析和主客观关联解释手段。本发明提供一种面向音乐源分离的主客观协同评估方法及系统，通过构建统一评测平台，将"数据准备—分离执行—客观指标计算—主观专家评分—主客观关联分析—统计反馈"整合为闭环工作流。'),

        headingParagraph('技术方案', HeadingLevel.HEADING_2),
        chineseParagraph('本发明提供一种面向音乐源分离的主客观协同评估方法，包括以下步骤：'),
        chineseParagraph('步骤S1，音频数据管理步骤：以标准化资源单元（Mixture + Gold Vocals/Drums/Bass/Other）为基础，将混合音频与对应的多轨独立声源参考音轨进行结构化存储，并对音频进行统一预处理，包括重采样至44.1kHz、声道规整为单声道、格式转换为PCM 16bit。'),
        chineseParagraph('步骤S2，多引擎分离调度步骤：通过策略模式构建统一的分离引擎抽象接口，支持多种分离引擎的灵活切换，所述多种分离引擎包括：基于ZFTurbo Music-Source-Separation-Training仓库的本地推理引擎（MSSLocalEngine）、基于ffmpeg滤波器的模拟演示引擎（MockSeparationEngine）、基于HTTP协议的远程模型服务引擎（HttpSeparationEngine）、以及自定义本地脚本引擎（LocalSeparationEngine）。引擎选择通过环境变量SEPARATION_ENGINE控制，支持mss/mock/http/local四种模式。'),
        chineseParagraph('步骤S3，分离任务异步执行步骤：通过单例模式的异步任务队列管理器（TaskQueueManager）对分离任务进行FIFO队列调度，支持单任务串行处理以避免GPU显存溢出，提供队列位置查询、任务取消（包括队列移除与进程终止的双重取消机制）、以及CPU/GPU计算模式动态切换。任务取消通过全局取消标记集合（_CANCELLED_TASK_IDS）实现软中断到硬中断的桥接。'),
        chineseParagraph('步骤S4，客观指标自动计算步骤：对每个分离任务的估计信号，系统自动计算客观评价指标。所述客观评价指标包括：'),
        chineseParagraph('（a）基于BSS Eval v3多源评估框架的指标：通过将估计信号向各参考源子空间投影，将估计信号分解为目标分量、空间失真误差、干扰误差和伪影误差，进而计算源失真比SDR（Signal-to-Distortion Ratio）、源干扰比SIR（Signal-to-Interference Ratio）、源伪影比SAR（Signal-to-Artifacts Ratio）和图像空间比ISR（Image-to-Spatial Ratio）。'),
        chineseParagraph('（b）尺度不变源失真比SI-SDR：通过计算最优缩放因子α = <ŝ, s> / ||s||²，消除整体增益缩放对评估结果的影响。'),
        chineseParagraph('（c）重叠一致性辅助指标：包括波形重叠一致性WOC（Waveform Overlap Consistency）和频谱重叠一致性SOC（Spectrogram Overlap Consistency），基于L1归一化幅度表示和"交集/并集"（IoU-like）计算方式，将可视化分析中的"重叠程度"量化为[0,1]区间标量。具体定义为：对参考信号和估计信号的非负幅度（时域波形绝对值或时频域STFT幅度谱）进行L1归一化后，计算∑min(Ã, Â̂)/∑max(Ã, Â̂)。该指标与SDR/SI-SDR等全局失真指标形成互补，用于解释主客观差异。可选地，进一步包括相位一致性PC（基于复数STFT的相位匹配度）、感知加权PSOC（基于Mel或A-weighting的频域加权）以及互相关时间对齐等扩展模块。'),
        chineseParagraph('步骤S5，主观评价管理步骤：基于ITU-R BS.1534-1 MUSHRA规范设计主观评价流程，提供包括音质Quality、干扰抑制Interference、伪影控制Artifacts三个维度的结构化评分界面，采用双盲多激励听音测试方法，支持所有声部（Vocals/Drums/Bass/Other）的批量评分提交以确保数据完整性。'),
        chineseParagraph('步骤S6，主客观关联分析步骤：将同一分离任务的客观指标与主观评分进行关联，提供Spearman等级相关系数计算、排列检验（Permutation Test）以及Wilcoxon符号秩检验等统计分析方法，实现客观指标与主观感知质量之间关系的定量分析。特别是提供SOC与主观音质评分之间的Spearman等级相关分析和排列检验，以验证重叠一致性指标对主观听感的解释能力。'),

        headingParagraph('系统架构', HeadingLevel.HEADING_2),
        chineseParagraph('本发明还提供一种实现上述方法的面向音乐源分离的主客观协同评估系统，采用分层解耦架构，包括：'),
        chineseParagraph('（1）服务层：提供统一门户、任务交互、结果播放、评测分析、公共资源、消息通知与管理控制等用户可见能力。'),
        chineseParagraph('（2）业务层：实现JWT+RBAC认证授权、用户审批管理、任务与队列调度、Stem文件管理、主客观评测处理、资源库管理、系统配置管理与统计分析等核心业务逻辑。'),
        chineseParagraph('（3）技术层：基于React前端框架和FastAPI后端框架构建，配套异步任务队列管理器、MSS分离引擎组件、音频分析组件和客观指标计算组件。'),
        chineseParagraph('（4）数据层：采用MySQL关系型数据库持久化存储用户、任务、评分、资源、通知、配置、日志等数据，同时使用文件系统存储上传音频与分离结果文件。'),

        headingParagraph('有益效果', HeadingLevel.HEADING_2),
        chineseParagraph('与现有技术相比，本发明具有以下有益效果：'),
        chineseParagraph('（1）通过构建主客观协同评估闭环，首次将客观指标计算、主观专家评分和主客观关联分析整合为统一的评测工作流，打通了从"算法输出"到"感知质量"的完整链路，使模型优化从"离线试错"转变为"反馈驱动迭代"。'),
        chineseParagraph('（2）提出了重叠一致性辅助度量指标WOC/SOC，基于L1归一化幅度表示和交集/并集计算方式，将可视化分析中"波形/频谱重叠"的定性观察量化为可统计分析的定量指标，用于解释客观指标与主观听感之间的差异，并提供了频带级分析、相位一致性和感知加权等扩展能力。'),
        chineseParagraph('（3）采用策略模式设计多引擎分离架构，通过统一的SeparationEngine抽象接口和工厂方法build_separation_engine_from_env()，支持四种分离引擎的灵活切换，将"模型差异"收敛到推理模块内部，同时保持前后处理与输入输出规范的一致性，便于开展公平对比实验。'),
        chineseParagraph('（4）通过异步任务队列管理器和全局取消标记机制，实现了任务取消的软中断到硬中断桥接，能够在GPU推理过程中及时终止子进程以释放计算资源。'),
        chineseParagraph('（5）通过内置的Spearman等级相关、Wilcoxon符号秩检验和排列检验等统计方法，无需依赖外部统计软件即可完成主客观关联分析和算法间显著性检验，降低了评测工作流的技术门槛。'),

        // ===== 附图说明 =====
        headingParagraph('附图说明', HeadingLevel.HEADING_1),
        chineseParagraph('图1为本发明的问题解决逻辑示意图。'),
        chineseParagraph('图2为本发明的训练者与专家协作关系示意图。'),
        chineseParagraph('图3为本发明的系统总体架构图。'),
        chineseParagraph('图4为本发明的业务流程图。'),
        chineseParagraph('图5为本发明的用户故事地图。'),
        chineseParagraph('图6为本发明的音乐源分离算法标准化流水线图。'),
        chineseParagraph('图7为本发明的分离引擎策略模式架构图。'),
        chineseParagraph('图8为本发明的WOC/SOC重叠一致性指标计算原理图。'),
        chineseParagraph('图9为本发明的数据库实体关系（ER）图。'),

        // ===== 具体实施方式 =====
        headingParagraph('具体实施方式', HeadingLevel.HEADING_1),
        chineseParagraph('下面结合附图对本发明的具体实施方式进行详细说明。'),

        headingParagraph('实施例一：系统整体架构', HeadingLevel.HEADING_2),
        chineseParagraph('本实施例提供一种面向音乐源分离的主客观协同评估系统，采用图3所示的四层解耦架构。'),
        chineseParagraph('在数据层，使用MySQL 8.x关系型数据库进行数据持久化，设计了14张数据表，包括users（用户表）、separation_tasks（分离任务表）、stem_files（分离音频文件表）、scores（主观评分表）、audio_resources（音频资源表）、system_logs（系统日志表）、system_configs（系统配置表）、notifications（通知表）等。所有表的主键采用雪花ID（Snowflake ID）生成器生成，该生成器为64位分布式唯一ID，由41位时间戳、10位数据中心/机器ID和12位序列号组成，确保分布式场景下的全局唯一性。API响应中所有ID被序列化为字符串以避免JavaScript整数精度丢失问题。'),
        chineseParagraph('在技术层，后端采用Python FastAPI框架和Uvicorn ASGI服务器，支持异步请求处理。前端采用React框架和Recharts图表库进行数据可视化。分离引擎组件通过子进程调用的方式与模型推理脚本（inference.py）交互，避免了PyTorch等重依赖与后端主进程的版本冲突。'),

        headingParagraph('实施例二：多引擎分离架构', HeadingLevel.HEADING_2),
        chineseParagraph('本实施例详细描述图7所示的多引擎分离架构。定义抽象基类SeparationEngine，包含async def separate(input_path, algorithm, results_dir, task_id)接口方法，返回统一的SeparationResult数据结构（包含stems路径映射和可选的客观指标）。'),
        chineseParagraph('MSSLocalEngine为默认引擎，通过子进程调用ZFTurbo Music-Source-Separation-Training仓库的inference.py脚本。该引擎通过_MSSModelSpec数据类维护各算法（MDX23C、Demucs4HT、Band Split RoFormer、SCNet）的模型类型、默认配置文件和权重文件路径的映射关系。权重文件路径和配置文件路径均可通过环境变量覆盖。在Windows平台上，子进程管理使用专门的_run_subprocess_windows辅助函数，通过asyncio.to_thread在线程中运行同步subprocess.Popen。在Linux/Mac平台上，使用asyncio.create_subprocess_exec进行原生异步子进程管理。'),
        chineseParagraph('MockSeparationEngine使用ffmpeg音频滤波器（highpass/lowpass/bandpass/treble）对输入音频进行不同频段的滤波处理来模拟分离效果，用于前端联调测试和演示场景。当ffmpeg不可用时，回退到正弦波生成方案。'),
        chineseParagraph('HttpSeparationEngine通过httpx异步HTTP客户端向远程模型服务发起multipart/form-data POST请求，接收base64编码的WAV音频流和可选的客观指标数据。LocalSeparationEngine通过子进程调用用户自定义的本地推理脚本。'),
        chineseParagraph('引擎选择通过环境变量SEPARATION_ENGINE控制，工厂函数build_separation_engine_from_env()读取该变量并返回对应的引擎实例，默认值为mss。'),

        headingParagraph('实施例三：任务队列与取消机制', HeadingLevel.HEADING_2),
        chineseParagraph('任务队列管理器TaskQueueManager采用单例模式实现，内部维护一个asyncio.Queue作为FIFO任务队列。任务的入队、出队和处理状态通过_separation_tasks字典进行跟踪。队列管理器支持以下操作：enqueue(task_id)将任务加入队列并启动后台处理协程；get_queue_position(task_id)返回任务在队列中的当前位置；cancel_task(task_id)实现双重取消——从队列中移除待处理任务或将正在处理的任务通过全局取消标记集合_CANCELLED_TASK_IDS标记为已取消。'),
        chineseParagraph('取消机制的详细实现如下：后端API端点/api/tasks/{task_id}/cancel调用mark_task_cancelled(task_id)将任务ID加入_CANCELLED_TASK_IDS集合。分离引擎在执行子进程输出读取的循环中，通过is_task_marked_cancelled(task_id)轮询检查该标记。一旦检测到取消标记，引擎首先尝试terminate()优雅终止子进程，若失败则调用kill()强制终止，最后抛出RuntimeError("CANCELLED_BY_USER")通知上层服务。任务完成后，通过clear_task_cancelled(task_id)清理取消标记。'),
        chineseParagraph('系统支持通过环境变量SEPARATION_COMPUTE_MODE或数据库系统配置项separation_compute_mode动态切换CPU/GPU计算模式。在CPU模式下，自动设置CUDA_VISIBLE_DEVICES=""并添加--force_cpu参数到inference.py调用命令中。'),

        headingParagraph('实施例四：客观指标计算方法', HeadingLevel.HEADING_2),
        chineseParagraph('本实施例详细描述步骤S4中的客观指标计算方法。'),
        chineseParagraph('对于两源假设场景（mixture = target + interference），objective_metrics.py模块采用最小二乘投影方法：将混合信号向目标源子空间和干扰源子空间投影，将估计信号分解为目标分量、干扰分量和伪影分量，再分别计算SDR、SIR、SAR和SI-SDR。SI-SDR通过计算最优缩放因子α = <ŝ_ref, s_ref> / ||s_ref||²实现尺度不变性。同时计算残差音频r = mixture - estimate供主观试听使用。'),
        chineseParagraph('对于多源完整场景，objective_metrics_multisource.py模块实现BSS Eval v3（Vincent et al. 2006）的全套投影分解算法。通过_hamo_product函数实现Hadamard积辅助运算，通过_projection_operator函数实现向参考信号子空间的正交投影。将估计信号ŝ_j分解为：ŝ_j = s_j + e_spat + e_interf + e_artif，其中s_j为目标源，e_spat为空间/滤波失真，e_interf为其他源泄漏造成的干扰，e_artif为算法引入的伪影。基于各分量的能量比计算SDR、SIR、SAR和ISR。'),
        chineseParagraph('overlay_metrics.py模块实现了WOC/SOC重叠一致性指标。计算流程如图8所示：将参考信号和估计信号的非负幅度（波形绝对值或STFT幅度谱）进行L1归一化后，计算∑min(Ã, Â̂) / ∑max(Ã, Â̂)，得到[0,1]区间内的重叠一致性得分。该指标基于幅度/能量表示，对相位误差不敏感，主要刻画能量分布与局部结构的一致性，与SDR/SI-SDR等全局失真指标形成互补。当需要定位特定频段问题时，可将求和范围限制在频带集合B_k上生成频带级指标SOC_k。'),

        headingParagraph('实施例五：主观评价与统计分析', HeadingLevel.HEADING_2),
        chineseParagraph('主观评价模块参考ITU-R BS.1534-1 MUSHRA规范设计。评分界面提供音质（Quality，衡量整体清晰度、保真度和自然度）、干扰抑制（Interference，衡量目标声部中非目标声部的残留程度）和伪影控制（Artifacts，衡量算法引入的非自然成分如金属音、抖动感和断续感）三个维度的1-5分李克特量表。所有4个声部的评分通过POST /api/scores/{task_id}端点一次性批量提交。'),
        chineseParagraph('统计分析模块从零实现了三种统计方法，不依赖SciPy等外部统计库：'),
        chineseParagraph('（1）Spearman等级相关系数：对两组数据进行排序并分配秩次，对打结（tied ranks）数据采用平均秩处理，计算秩次之间的Pearson相关系数作为Spearman ρ。'),
        chineseParagraph('（2）排列检验（Permutation Test）：通过多次随机打乱数据标签构造零分布，计算观测统计量在零分布中的位置以得到单侧p值。用于评估SOC与主观音质评分之间相关性的统计显著性。'),
        chineseParagraph('（3）Wilcoxon符号秩检验：对配对样本的差值进行排序并分配符号秩，通过正态近似计算z统计量和p值，在存在打结时进行方差修正以获得校正后的p值，同时计算秩双列相关系数（rank-biserial correlation）作为效应量指标。用于算法间配对差异的显著性检验。'),

        headingParagraph('实施例六：完整评测工作流', HeadingLevel.HEADING_2),
        chineseParagraph('本实施例描述使用本发明系统进行音乐源分离评测的完整工作流。参照图4的业务流程：'),
        chineseParagraph('第一步，数据准备：管理员或专家用户通过音频资源库上传评测所需的混合音频（Mixture）及对应的参考标准音轨（Gold Vocals/Drums/Bass/Other），系统自动进行音频格式标准化处理。评测数据集选用MUSDB18标准数据集，包含150首多风格音乐曲目（训练集100首、测试集50首），44.1kHz立体声格式。'),
        chineseParagraph('第二步，分离任务执行：专家用户选择目标混合音频和分离算法（MDX23C/Demucs4HT/Band Split RoFormer/SCNet之一），系统生成唯一任务ID并通过异步队列调度执行。分离引擎加载对应算法的预训练模型权重，对输入音频进行推理，输出四个声部文件（Vocals.wav/Drums.wav/Bass.wav/Other.wav）。处理过程中实时输出进度百分比。'),
        chineseParagraph('第三步，客观指标计算：系统自动调用指标计算模块，逐声部计算SDR、SIR、SAR、ISR、SI-SDR和WOC/SOC，将结果写入数据库并提供JSON格式的详细报告。'),
        chineseParagraph('第四步，主观评价：评审专家在双盲条件下对分离结果进行听音评价，在三个维度上为每个声部打分。平台同时提供残差试听功能（r = mixture - estimate）和波形/频谱可视化对比工具辅助判断。'),
        chineseParagraph('第五步，综合分析：通过平台的统计对比页面查看各算法的客观指标汇总（柱状图、雷达图）、主观评分统计、算法间Wilcoxon显著性检验结果、以及SOC-音质Spearman相关分析和排列检验结果。所有数据可通过CSV导出和论文数据包（ZIP）功能完整导出。'),

        chineseParagraph('以上所述仅为本发明的优选实施例，并非因此限制本发明的专利范围，凡是利用本发明说明书及附图内容所作的等效结构或等效流程变换，或直接或间接运用在其他相关的技术领域，均同理包括在本发明的专利保护范围内。'),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(BASE + '\\100002说明书.docx', buffer);
  console.log('说明书 已生成');
}

// ============================================================
// 文档二：权利要求书 (100001权利要求书.docx)
// ============================================================
async function createClaims() {
  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONT, size: 24 } } },
    },
    numbering: {
      config: [
        { reference: 'claims', levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        ]},
      ],
    },
    sections: [{
      properties: { page: { size: PAGE_SIZE, margin: PAGE_MARGIN } },
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '权利要求书', font: FONT, size: 18, color: '888888' })],
        })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '第 ', font: FONT, size: 18 }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 }), new TextRun({ text: ' 页', font: FONT, size: 18 })],
        })] }),
      },
      children: [
        new Paragraph({ spacing: { before: 600 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 360 },
          children: [new TextRun({ text: '权利要求书', font: '黑体', size: 32, bold: true })],
        }),

        // 独立权利要求1
        chineseParagraph('1. 一种面向音乐源分离的主客观协同评估方法，其特征在于，包括以下步骤：', { bold: true }),
        chineseParagraph('步骤S1，音频数据管理步骤：以标准化资源单元为基础，将混合音频与对应的多轨独立声源参考音轨进行结构化存储，并对音频进行统一预处理，包括重采样、声道规整和格式转换；'),
        chineseParagraph('步骤S2，多引擎分离调度步骤：通过策略模式构建统一的分离引擎抽象接口，支持多种分离引擎的灵活切换，所述多种分离引擎包括基于本地推理仓库的子进程调用引擎、基于ffmpeg滤波器的模拟演示引擎、基于HTTP协议的远程模型服务引擎以及自定义本地脚本引擎，引擎选择通过环境变量控制；'),
        chineseParagraph('步骤S3，分离任务异步执行步骤：通过单例模式的异步任务队列管理器对分离任务进行FIFO队列调度，支持单任务串行处理，提供队列位置查询、任务取消以及CPU/GPU计算模式动态切换功能，其中任务取消通过全局取消标记集合实现软中断到硬中断的桥接；'),
        chineseParagraph('步骤S4，客观指标自动计算步骤：对每个分离任务的估计信号，自动计算客观评价指标，所述客观评价指标包括基于BSS Eval多源评估框架的SDR/SIR/SAR/ISR指标、尺度不变源失真比SI-SDR指标、以及基于L1归一化幅度表示和交集/并集计算方式的重叠一致性指标WOC/SOC；'),
        chineseParagraph('步骤S5，主观评价管理步骤：基于MUSHRA规范设计主观评价流程，提供包括音质、干扰抑制、伪影控制三个维度的结构化评分界面，采用双盲多激励听音测试方法，支持所有声部的批量评分提交；'),
        chineseParagraph('步骤S6，主客观关联分析步骤：将同一分离任务的客观指标与主观评分进行关联，提供Spearman等级相关系数计算、排列检验以及Wilcoxon符号秩检验，实现客观指标与主观感知质量之间关系的定量分析。'),

        // 从属权利要求
        chineseParagraph('2. 根据权利要求1所述的方法，其特征在于，步骤S4中所述重叠一致性指标WOC/SOC的具体计算方式为：对参考信号和估计信号的非负幅度进行L1归一化后，按以下公式计算重叠一致性得分：OC = ∑min(Ã, Â̂) / ∑max(Ã, Â̂)；其中，所述非负幅度为时域波形绝对值时得到的指标为WOC，所述非负幅度为时频域STFT幅度谱时得到的指标为SOC。', { bold: true }),

        chineseParagraph('3. 根据权利要求2所述的方法，其特征在于，所述重叠一致性指标进一步包括以下扩展模块中的至少一种：（a）相位一致性PC，基于复数STFT的互相关度刻画相位结构匹配；（b）时间对齐机制，通过互相关估计最优延迟τ*后对齐再计算重叠一致性；（c）感知加权PSOC，基于Mel或A-weighting频率权重在频谱一致性中引入人耳敏感度差异。', { bold: true }),

        chineseParagraph('4. 根据权利要求1所述的方法，其特征在于，步骤S4中所述BSS Eval多源评估框架的实现方式为：通过将估计信号向各参考源子空间投影，将估计信号分解为目标分量s、空间失真误差e_spat、干扰误差e_interf和伪影误差e_artif四个分量，再基于各分量的能量比计算SDR、SIR、SAR和ISR。', { bold: true }),

        chineseParagraph('5. 根据权利要求1所述的方法，其特征在于，步骤S3中所述任务取消的软中断到硬中断桥接机制为：后端API接收取消请求后将任务ID加入全局取消标记集合，分离引擎在子进程输出读取循环中轮询检查该集合，检测到取消标记后先尝试terminate()优雅终止子进程，若失败则调用kill()强制终止，最后抛出取消异常通知上层服务。', { bold: true }),

        chineseParagraph('6. 根据权利要求1所述的方法，其特征在于，步骤S6中所述Spearman等级相关系数的计算采用从零实现的算法，包括对打结数据采用平均秩处理；所述排列检验通过多次随机打乱数据标签构造零分布以计算单侧p值；所述Wilcoxon符号秩检验包含正态近似、打结方差修正和秩双列效应量计算。', { bold: true }),

        chineseParagraph('7. 一种实现权利要求1-6任一项所述方法的面向音乐源分离的主客观协同评估系统，其特征在于，采用分层解耦架构，包括：服务层，提供统一门户、任务交互、结果播放、评测分析、公共资源、消息通知与管理控制功能；业务层，实现认证授权、用户审批管理、任务与队列调度、Stem文件管理、主客观评测处理、资源库管理、系统配置管理与统计分析功能；技术层，基于React前端框架和FastAPI后端框架构建，配套异步任务队列管理器、MSS分离引擎组件、音频分析组件和客观指标计算组件；以及数据层，采用MySQL关系型数据库进行数据持久化，同时使用文件系统存储音频文件。', { bold: true }),

        chineseParagraph('8. 根据权利要求7所述的系统，其特征在于，所述多引擎分离调度采用策略模式实现，定义抽象基类SeparationEngine包含统一的separate()接口方法，返回包括stems路径映射和可选客观指标的SeparationResult数据结构；通过工厂函数build_separation_engine_from_env()读取环境变量SEPARATION_ENGINE的值返回对应引擎实例，支持mss、mock、http、local四种模式。', { bold: true }),

        chineseParagraph('9. 根据权利要求7所述的系统，其特征在于，所述系统的数据库表结构包括：users用户表、separation_tasks分离任务表、stem_files分离音频文件表、scores主观评分表、audio_resources音频资源表、system_logs系统日志表、system_configs系统配置表、notifications通知表；所有表的主键采用64位雪花ID生成器生成，由41位时间戳、10位数据中心/机器ID和12位序列号组成，API响应中ID统一序列化为字符串。', { bold: true }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(BASE + '\\100001权利要求书.docx', buffer);
  console.log('权利要求书 已生成');
}

// ============================================================
// 文档三：说明书摘要 (100004说明书摘要.docx)
// ============================================================
async function createAbstract() {
  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONT, size: 24 } } },
    },
    sections: [{
      properties: { page: { size: PAGE_SIZE, margin: PAGE_MARGIN } },
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '说明书摘要', font: FONT, size: 18, color: '888888' })],
        })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '第 ', font: FONT, size: 18 }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 }), new TextRun({ text: ' 页', font: FONT, size: 18 })],
        })] }),
      },
      children: [
        new Paragraph({ spacing: { before: 600 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 200 },
          children: [new TextRun({ text: '一种面向音乐源分离的主客观协同评估方法及系统', font: '黑体', size: 28, bold: true })],
        }),

        new Paragraph({ spacing: { before: 120 } }),

        chineseParagraph('本发明公开了一种面向音乐源分离的主客观协同评估方法及系统，涉及音频信号处理与深度学习技术领域。该方法包括：以标准化资源单元对音频数据进行结构化管理和预处理；通过策略模式构建统一的分离引擎抽象接口，支持多种分离引擎的灵活切换；通过异步任务队列管理器进行FIFO调度，提供软中断到硬中断桥接的任务取消机制；自动计算包括BSS Eval v3多源评估指标、SI-SDR尺度不变指标以及基于L1归一化幅度和交集/并集计算方式的重叠一致性指标WOC/SOC；基于MUSHRA规范管理多维度主观评价；以及通过Spearman等级相关、排列检验和Wilcoxon符号秩检验实现主客观关联分析。本发明通过构建"数据准备—分离执行—客观指标计算—主观评价—主客观关联分析—统计反馈"的评测闭环，解决了现有技术中实验数据分散、主客观评估割裂和结果可视化不足的问题。'),

        new Paragraph({ spacing: { before: 120 } }),

        // 摘要附图标注
        chineseParagraph('摘要附图：图3（系统总体架构图）', { alignment: AlignmentType.CENTER }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(BASE + '\\100004说明书摘要.docx', buffer);
  console.log('说明书摘要 已生成');
}

// ============================================================
// 文档四：说明书附图 (100003说明书附图.docx)
// ============================================================
async function createDrawings() {
  // 检查是否有图片文件
  const imgDir = 'D:\\code\\AudioLab\\docs\\图片';
  const imgFiles = [];
  const imgNames = [
    '问题解决逻辑图.png',
    '训练者与专家协作图.png',
    '总体架构图.png',
    '业务流程图.png',
    '用户故事地图.png',
    '音乐源分离算法流程图.png',
  ];

  for (const name of imgNames) {
    const p = imgDir + '\\' + name;
    if (fs.existsSync(p)) {
      imgFiles.push({ path: p, name: name });
    }
  }

  const children = [
    new Paragraph({ spacing: { before: 600 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 360 },
      children: [new TextRun({ text: '说明书附图', font: '黑体', size: 32, bold: true })],
    }),
  ];

  if (imgFiles.length > 0) {
    const { ImageRun } = require('docx');
    for (let i = 0; i < imgFiles.length; i++) {
      const img = imgFiles[i];
      const imgData = fs.readFileSync(img.path);
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 60 },
          children: [new TextRun({ text: `图${i + 1}`, font: '黑体', size: 24, bold: true })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 60 },
          children: [new ImageRun({
            type: 'png',
            data: imgData,
            transformation: { width: 500, height: 350 },
            altText: { title: `图${i + 1}`, description: `图${i + 1}`, name: `fig${i + 1}` },
          })],
        }),
        new Paragraph({ spacing: { before: 60, after: 200 } }),
      );
      if (i < imgFiles.length - 1) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
    }
  } else {
    // 没有图片文件时，提供图的说明
    for (let i = 1; i <= 9; i++) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 300, after: 60 },
          children: [new TextRun({ text: `图${i}`, font: '黑体', size: 28, bold: true })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 200 },
          children: [new TextRun({ text: `（附图${i}：请参见项目 docs/图片/ 目录下的对应图片文件）`, font: FONT, size: 21, italics: true })],
        }),
      );
      if (i < 9) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
    }
  }

  const doc = new Document({
    sections: [{
      properties: { page: { size: PAGE_SIZE, margin: PAGE_MARGIN } },
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '说明书附图', font: FONT, size: 18, color: '888888' })],
        })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '第 ', font: FONT, size: 18 }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 }), new TextRun({ text: ' 页', font: FONT, size: 18 })],
        })] }),
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(BASE + '\\100003说明书附图.docx', buffer);
  console.log(`说明书附图 已生成 (${imgFiles.length} 张图片)`);
}

// ============================================================
// 文档五：实质审查请求书 (110401实质审查请求书.docx)
// ============================================================
async function createExamRequest() {
  const fieldCell = (label, width1, valueWidth) => [
    cell(label, width1, { bold: true, shading: 'E8E8E8' }),
    cell('', valueWidth || (9360 - width1)),
  ];

  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONT, size: 24 } } },
    },
    sections: [{
      properties: { page: { size: PAGE_SIZE, margin: PAGE_MARGIN } },
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '实质审查请求书', font: FONT, size: 18, color: '888888' })],
        })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '第 ', font: FONT, size: 18 }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 }), new TextRun({ text: ' 页', font: FONT, size: 18 })],
        })] }),
      },
      children: [
        new Paragraph({ spacing: { before: 400 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 300 },
          children: [new TextRun({ text: '实质审查请求书', font: '黑体', size: 32, bold: true })],
        }),

        // 基本信息
        new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text: '专利申请信息', font: '黑体', size: 24, bold: true })] }),

        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2500, 6860],
          rows: [
            new TableRow({ children: fieldCell('申请号', 2500, 6860) }),
            new TableRow({ children: fieldCell('发明创造名称', 2500, 6860) }),
            new TableRow({ children: fieldCell('申请人', 2500, 6860) }),
            new TableRow({ children: fieldCell('递交日', 2500, 6860) }),
          ],
        }),

        new Paragraph({ spacing: { before: 200, after: 60 }, children: [new TextRun({ text: '请求内容', font: '黑体', size: 24, bold: true })] }),
        chineseParagraph('根据专利法第35条的规定，请求对上述专利申请进行实质审查。'),
        chineseParagraph('申请人声明：不放弃专利法实施细则第57条规定的主动修改的权利。'),

        new Paragraph({ spacing: { before: 200, after: 60 }, children: [new TextRun({ text: '附件清单', font: '黑体', size: 24, bold: true })] }),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2500, 6860],
          rows: [
            new TableRow({ children: fieldCell('申请文件替换文件', 2500, 6860) }),
            new TableRow({ children: fieldCell('参考资料', 2500, 6860) }),
            new TableRow({ children: fieldCell('检索资料', 2500, 6860) }),
            new TableRow({ children: fieldCell('审查结果资料', 2500, 6860) }),
          ],
        }),

        new Paragraph({ spacing: { before: 200, after: 60 }, children: [new TextRun({ text: '签字或盖章', font: '黑体', size: 24, bold: true })] }),
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [2500, 6860],
          rows: [
            new TableRow({ children: [
              cell('申请人或专利代理机构签字或者盖章', 2500, { bold: true, shading: 'E8E8E8' }),
              cell('（请在此处签字/盖章）', 6860),
            ]}),
            new TableRow({ children: [
              cell('日期', 2500, { bold: true, shading: 'E8E8E8' }),
              cell('    年    月    日', 6860),
            ]}),
          ],
        }),

        new Paragraph({ spacing: { before: 400 } }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: '注意事项', font: '黑体', size: 24, bold: true })],
        }),
        chineseParagraph('一、本表应当使用中文填写，字迹为黑色，文字应当打字或印刷，提交一式一份。'),
        chineseParagraph('二、本表第①栏所填内容应当与该专利申请请求书中内容一致。如果该专利申请办理过著录项目变更手续的，应当按照国家知识产权局批准变更后的内容填写。'),
        chineseParagraph('三、申请人应当在专利法实施细则规定的期限内缴纳实质审查费。'),
        chineseParagraph('四、专利费用可以通过网上缴费、银行/邮局汇款、直接向代办处或国家知识产权局专利局缴纳。'),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(BASE + '\\110401实质审查请求书.docx', buffer);
  console.log('实质审查请求书 已生成');
}

// ============================================================
// 执行生成
// ============================================================
(async () => {
  console.log('开始生成专利文档...\n');
  await createSpecification();
  await createClaims();
  await createAbstract();
  await createDrawings();
  await createExamRequest();
  console.log('\n所有文档生成完毕！');
})().catch(err => {
  console.error('生成失败:', err);
  process.exit(1);
});
