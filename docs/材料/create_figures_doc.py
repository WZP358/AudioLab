import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from docx import Document
from docx.shared import Inches, Pt, Cm, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

doc = Document()

# Set default font
style = doc.styles['Normal']
font = style.font
font.name = '宋体'
font.size = Pt(12)
style.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

# Page margins
for section in doc.sections:
    section.top_margin = Cm(2.54)
    section.bottom_margin = Cm(2.54)
    section.left_margin = Cm(2.54)
    section.right_margin = Cm(2.54)

# Title
title_para = doc.add_paragraph()
title_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
title_run = title_para.add_run('附图说明')
title_run.bold = True
title_run.font.size = Pt(16)
title_run.font.name = '宋体'
title_run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

images_dir = r'D:\code\AudioLab\docs\材料\images'

figures = [
    # ===== 设计图纸 =====
    ("问题解决逻辑图.png",
     "图1  问题解决逻辑图",
     "本图展示了本发明所要解决的三个核心问题及其对应的技术方案。左侧列出算法评估中存在的三大痛点：实验数据分散存储缺乏统一管理、主客观评估割裂难以全面衡量算法性能、数据可视化困难结果对比不方便。右侧对应给出本发明的解决思路——构建统一数据管理平台、建立主客观协同评估机制、提供交互式可视化分析工具。该图明确了本发明的工程目标与设计出发点。"),

    ("训练者与专家协作图.png",
     "图2  训练者与专家协作关系图",
     "本图展示了算法工程师（训练者）与音频专家（主观评审员）两类核心角色通过本发明平台实现协作的关系。训练者负责模型训练与分离执行，产生客观指标数据；专家负责主观听感评分与反馈。平台作为中枢，将客观指标与主观评分进行关联分析，并将分析结果反馈给训练者以指导模型优化方向。该图体现了本发明的核心设计理念——将模型优化从离线试错转变为反馈驱动迭代。"),

    ("总体架构图.png",
     "图3  系统总体架构图",
     "本图展示了本发明系统的四层解耦架构。自顶向下依次为：服务层（统一门户、任务交互、结果播放、评测分析、公共资源、消息通知、管理控制），业务层（认证授权、用户管理、任务调度、文件管理、评测处理、资源管理、配置管理、统计分析），技术层（React前端、FastAPI后端、异步任务队列、MSS分离引擎、音频分析组件、客观指标计算组件），数据层（MySQL数据库、文件系统存储）。该架构实现了前后端分离、任务异步化和模型引擎抽象，保证了系统的可扩展性与可维护性。"),

    ("业务流程图.png",
     "图4  业务流程图",
     "本图展示了从模型训练到专家评估的完整业务闭环。流程始于训练者进行模型训练，经分离引擎对混合音频执行源分离，自动计算客观指标（SDR、SIR、SAR、SI-SDR、WOC/SOC），再由专家进行三维度主观评分（音质、干扰抑制、伪影控制），最终通过主客观关联分析（Spearman相关、Wilcoxon检验、排列检验）将结论反馈给训练者以指导下一轮优化。该图体现了评测—反馈—优化—再评测的闭环机制。"),

    ("用户故事地图.png",
     "图5  用户故事地图",
     "本图以用户故事地图的形式，按角色和时间维度展开平台的功能规划。横轴为业务流程阶段（注册与认证、资源准备、任务执行、结果分析、评价与反馈），纵轴为角色分层（访客、专家、管理员）。各单元格描述了对应用户在该阶段的具体操作需求。该图是平台功能开发优先级排序的依据，体现了以用户角色为中心的迭代式交付策略。"),

    ("音乐源分离算法流程图.png",
     "图6  音乐源分离算法流程图",
     "本图展示了平台中标准化的音乐源分离算法流水线。输入音频首先经过预处理（重采样至44.1kHz、声道规整为单声道、格式转换为PCM 16bit），随后进行STFT变换得到时频表示，送入模型进行推理（支持MDX23C、Demucs4HT、Band Split RoFormer、SCNet等多种算法），经逆STFT还原为时域波形，最后经后处理（归一化、限幅）输出四个分离声部（人声、鼓、贝斯、其他）。该流水线设计将模型差异收敛到推理模块内部，保持了前后处理规范的一致性，便于开展公平对比实验。"),

    # ===== 系统界面截图 =====
    ("1.登录界面.png",
     "图7  登录界面",
     "本图为本发明系统的主登录界面。页面中央提供用户名与密码输入框，下方设有记住我选项和登录按钮，底部提供注册链接供新用户跳转。左侧为系统导航栏，展示平台各功能模块入口。系统采用JWT令牌认证机制，登录成功后根据用户角色（访客/专家/管理员）展示对应的功能菜单。"),

    ("2.注册界面.png",
     "图8  用户注册界面",
     "本图为本发明系统的用户注册界面。新用户需填写用户名、邮箱、密码等基本信息，并通过邮箱验证码完成身份验证。专家注册还需提交资质说明，申请提交后由管理员在后台审批。该界面实现了三种角色（访客、专家、管理员）的统一注册入口，其中专家角色需审批通过后方可参与主观评分。"),

    ("3.选择混合音频.png",
     "图9  选择混合音频界面",
     "本图展示用户在创建分离任务时选择混合音频的操作界面。音频文件以列表形式展示，包含文件名、时长、采样率等信息，支持搜索和筛选。用户从公共资源库中选取待分离的混合音频（Mixture），该音频将作为分离引擎的输入。平台支持44.1kHz采样率、PCM 16bit格式的标准音频文件。"),

    ("4.选择金标准音频.png",
     "图10  选择金标准音频界面",
     "本图展示用户上传和选择参考标准音轨（Gold Stems）的界面。参考音轨包含人声、鼓、贝斯、其他四个独立声部，作为后续客观指标计算的基准信号。平台以标准化资源单元（Mixture + Gold Vocals/Drums/Bass/Other）组织数据，确保每组评测数据语境的完整性和一致性。"),

    ("5.选择音乐源分离算法.png",
     "图11  选择分离算法界面",
     "本图展示用户从已集成算法库中选择目标分离算法的界面。界面列出各算法的名称、简介及适用场景，当前集成算法包括MDX23C、Demucs4HT、Band Split RoFormer和SCNet。选择后分离引擎将通过统一的SeparationEngine接口调用对应模型的推理脚本，屏蔽底层实现差异。"),

    ("6.选择指定音轨.png",
     "图12  选择指定音轨界面",
     "本图展示用户指定分离目标声部的界面。用户可勾选需要分离的声部类型——人声（Vocals）、鼓（Drums）、贝斯（Bass）、其他伴奏（Other），系统将仅对选中的目标声部执行分离推理。该设计允许用户按需分离，节省计算资源。"),

    ("7.可视化分析.png",
     "图13  可视化分析界面",
     "本图为本发明系统的可视化分析核心界面。上方以波形图对比展示参考信号（蓝色）与估计信号（橙色）的时域差异，下方以频谱图展示两者的时频分布。用户可通过拖拽、缩放等交互操作定位特定时间段进行分析。该界面同时提供残差试听功能（r = mixture − estimate），使评审员能够直接监听被算法滤除或残留的信号成分，辅助判断分离质量。"),

    ("8.频率分析对比.png",
     "图14  频率分析对比界面",
     "本图展示不同算法在同一音频上的频谱对比。以并排或叠加方式呈现各算法分离结果的频谱图，直观对比不同算法在各频段的能量分布差异。该功能支撑了声部泄漏检测——当某算法在目标声部频段外出现异常能量时，可在频谱图中直接定位，为后续WOC/SOC重叠一致性指标的频带级分析提供可视化依据。"),

    ("9.专家评分与实时评分统计.png",
     "图15  专家评分与实时评分统计界面",
     "本图为本发明系统的主观评价核心界面。左侧为评分面板，专家在双盲条件下（不知晓所听音频对应的算法）对每个声部进行三维度评分：音质（1-5分，衡量清晰度与自然度）、干扰抑制（1-5分，衡量非目标声部残留程度）、伪影控制（1-5分，衡量算法引入的金属音、断续等非自然成分）。所有四个声部的评分一次性批量提交。右侧为实时评分统计图表，展示各算法的得分分布与均值。评分流程参照ITU-R BS.1534-1 MUSHRA规范设计。"),

    ("10.分离历史记录.png",
     "图16  分离历史记录界面",
     "本图展示用户的分离任务历史列表。每条记录包含任务ID、音频名称、使用算法、执行时间、任务状态（排队中/处理中/已完成/已取消/失败）等信息。用户可在此查看历史任务的客观指标结果、下载分离音频文件或跳转至可视化分析页面。任务取消功能支持用户随时终止排队或执行中的任务。"),

    ("11.社区评估数据.png",
     "图17  社区评估数据界面",
     "本图展示所有用户公开的评估数据汇总页面。该页面集中呈现各项评测的客观指标均值与标准差、主观评分分布、算法排名等汇总信息，支持按算法、声部、评分维度进行筛选和排序，为研究者提供多维度对比视角。"),

    ("12.音频资源管理.png",
     "图18  音频资源管理界面",
     "本图展示公共音频资源的管理界面。支持音频文件的上传、浏览、分类筛选和下载。上传时支持捆绑模式——将Mixture与四个Gold Stems打包上传，系统自动解析文件结构并建立关联。资源列表展示文件名、类型、时长、上传者、上传时间等元数据。"),

    ("13.后台管理系统.png",
     "图19  后台管理系统界面",
     "本图为本发明系统的管理员后台面板。包含用户审批（专家资质审核与角色分配）、系统配置管理（键值对配置项，支持separation_compute_mode等运行时参数动态调整）、系统日志审计（记录关键操作的时间、用户、IP、操作描述）以及数据统计仪表盘（用户增长、任务统计、资源统计等可视化图表）。"),

    # ===== 研发环境照片 =====
    ("IMG_20260715_191316.jpg",
     "图20  研发环境照片一",
     "本照片展示了本发明系统的实际研发工作场景，包括开发工作站、代码编辑器及系统运行界面。开发环境为Windows 11操作系统，配备NVIDIA GPU用于模型推理调试。"),

    ("IMG_20260715_191355.jpg",
     "图21  研发环境照片二",
     "本照片展示了本发明系统的开发与调试过程。后端采用Python FastAPI框架和Uvicorn ASGI服务器，前端采用React框架，数据库采用MySQL 8.x，分离引擎通过子进程调用方式与模型推理脚本交互。"),

    ("IMG_20260715_191401.jpg",
     "图22  研发环境照片三",
     "本照片展示了本发明系统的运行测试场景，包括多算法分离任务执行、客观指标自动计算结果展示以及主观评价流程的运行状态。"),
]

max_width = Inches(5.8)

for fname, title, desc in figures:
    fpath = os.path.join(images_dir, fname)

    # Title paragraph (bold)
    title_para = doc.add_paragraph()
    title_run = title_para.add_run(title)
    title_run.bold = True
    title_run.font.size = Pt(12)
    title_run.font.name = '宋体'
    title_run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

    # Description paragraph (indented body text)
    desc_para = doc.add_paragraph()
    desc_run = desc_para.add_run(desc)
    desc_run.font.size = Pt(11)
    desc_run.font.name = '宋体'
    desc_run._element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')

    # Image paragraph
    if os.path.exists(fpath):
        img_para = doc.add_paragraph()
        img_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = img_para.add_run()
        try:
            run.add_picture(fpath, width=max_width)
            print(f"OK: {title}")
        except Exception as e:
            print(f"ERROR: {fname} - {e}")
    else:
        print(f"MISSING: {fname}")

    # Spacer
    doc.add_paragraph()

# Save
output_path = r'D:\code\AudioLab\docs\材料\附图说明.docx'
doc.save(output_path)
print(f"\nSaved to: {output_path}")
