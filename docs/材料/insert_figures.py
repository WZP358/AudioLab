import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from lxml import etree

doc = Document(r'D:\code\AudioLab\docs\材料\100002说明书.docx')

images_dir = r'D:\code\AudioLab\docs\材料\images'

# All figures with their descriptions and image files
figures = [
    # 设计图纸 (图1-图6)
    ("问题解决逻辑图.png", "图1为本发明的问题解决逻辑示意图。"),
    ("训练者与专家协作图.png", "图2为本发明的训练者与专家协作关系示意图。"),
    ("总体架构图.png", "图3为本发明的系统总体架构图。"),
    ("业务流程图.png", "图4为本发明的业务流程图。"),
    ("用户故事地图.png", "图5为本发明的用户故事地图。"),
    ("音乐源分离算法流程图.png", "图6为本发明的音乐源分离算法流程图。"),
    # 系统界面截图 (图7-图19)
    ("1.登录界面.png", "图7为本发明系统的登录界面截图，展示用户通过账号密码登录及记住密码功能。"),
    ("2.注册界面.png", "图8为本发明系统的用户注册界面截图，展示新用户注册时的信息填写与邮箱验证码验证流程。"),
    ("3.选择混合音频.png", "图9为本发明系统的选择混合音频界面截图，展示用户在创建分离任务时选择待分离的混合音频文件。"),
    ("4.选择金标准音频.png", "图10为本发明系统的选择金标准音频界面截图，展示用户上传参考音轨（金标准）作为后续客观指标计算的基准。"),
    ("5.选择音乐源分离算法.png", "图11为本发明系统的选择音乐源分离算法界面截图，展示用户从已集成的多种分离算法中选择目标算法。"),
    ("6.选择指定音轨.png", "图12为本发明系统的选择指定音轨界面截图，展示用户指定需要分离的目标声部（人声、鼓、贝斯、其他）。"),
    ("7.可视化分析.png", "图13为本发明系统的可视化分析界面截图，展示分离结果的波形对比与频谱对比可视化。"),
    ("8.频率分析对比.png", "图14为本发明系统的频率分析对比界面截图，展示不同算法在同一音频上的频谱差异对比。"),
    ("9.专家评分与实时评分统计.png", "图15为本发明系统的专家评分与实时评分统计界面截图，展示专家的三维度（音质、干扰抑制、伪影控制）评分面板及评分结果的实时统计图表。"),
    ("10.分离历史记录.png", "图16为本发明系统的分离历史记录界面截图，展示用户历史分离任务的列表及任务状态。"),
    ("11.社区评估数据.png", "图17为本发明系统的社区评估数据界面截图，展示所有用户公开的评估数据汇总与对比。"),
    ("12.音频资源管理.png", "图18为本发明系统的音频资源管理界面截图，展示公共音频资源的上传、浏览、分类与下载功能。"),
    ("13.后台管理系统.png", "图19为本发明系统的后台管理系统界面截图，展示管理员对用户审批、系统配置、日志审计等功能的管理面板。"),
    # 研发环境照片 (图20-图22)
    ("IMG_20260715_191316.jpg", "图20为本发明的研发环境照片一，展示开发工作站的实际工作场景。"),
    ("IMG_20260715_191355.jpg", "图21为本发明的研发环境照片二，展示系统开发与调试过程。"),
    ("IMG_20260715_191401.jpg", "图22为本发明的研发环境照片三，展示系统运行测试场景。"),
]

# Find the 附图说明 section heading and existing figure entries
fig_desc_heading_idx = None
fig6_idx = None
shishi_idx = None
for i, p in enumerate(doc.paragraphs):
    if p.style.name == 'Heading 1' and '附图说明' in p.text:
        fig_desc_heading_idx = i
    if p.text.startswith('图6为本发明的音乐源分离算法流程图'):
        fig6_idx = i
    if p.style.name == 'Heading 1' and '具体实施方式' in p.text:
        shishi_idx = i

print(f"附图说明 heading: P{fig_desc_heading_idx}")
print(f"图6: P{fig6_idx}")
print(f"具体实施方式: P{shishi_idx}")

if fig6_idx is None or shishi_idx is None:
    print("ERROR: Cannot find required paragraphs")
    sys.exit(1)

# Get the reference paragraph style from existing figure descriptions
ref_style = doc.paragraphs[fig6_idx].style

# Remove old 图1-图6 description paragraphs (P39-P44) since we'll re-add them with images
# Collect paragraph elements to remove
paras_to_remove = []
for i in range(fig_desc_heading_idx + 1, shishi_idx):
    paras_to_remove.append(doc.paragraphs[i]._element)

for elem in paras_to_remove:
    elem.getparent().remove(elem)

print(f"Removed {len(paras_to_remove)} old figure description paragraphs")

# Now insert all figure descriptions + images before 具体实施方式
# Find the 具体实施方式 element
shishi_element = doc.paragraphs[shishi_idx]._element

# We need to re-find shishi_idx after removal
# Let's find it again
for i, p in enumerate(doc.paragraphs):
    if p.style.name == 'Heading 1' and '具体实施方式' in p.text:
        shishi_idx = i
        shishi_element = p._element
        break

max_img_width = Inches(5.8)

# Insert in forward order. addprevious inserts immediately before reference,
# so calling addprevious(img) then addprevious(desc) gives: ... desc, img, reference ...
# Next iteration's elements go before desc, building forward order naturally.
for fname, desc in figures:
    fpath = os.path.join(images_dir, fname)

    # Create description paragraph
    desc_para = doc.add_paragraph(desc)
    desc_para.style = ref_style

    # Create image paragraph
    img_para = doc.add_paragraph()
    img_para.alignment = WD_ALIGN_PARAGRAPH.CENTER

    if os.path.exists(fpath):
        run = img_para.add_run()
        try:
            run.add_picture(fpath, width=max_img_width)
        except:
            try:
                run.add_picture(fpath)
            except Exception as e:
                print(f"ERROR: {fname} - {e}")
    else:
        print(f"WARNING: {fname} not found")

    # Insert image first, then description — so description appears before image
    shishi_element.addprevious(img_para._element)
    shishi_element.addprevious(desc_para._element)

print(f"Inserted {len(figures)} figure descriptions with images")

# Save
output_path = r'D:\code\AudioLab\docs\材料\100002说明书_完整版.docx'
doc.save(output_path)
print(f"Saved to: {output_path}")
print("Done!")
