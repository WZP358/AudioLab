from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from pathlib import Path

src=Path('docs/老师沟通材料包.md').read_text(encoding='utf-8')
doc=Document()
sec=doc.sections[0]
sec.top_margin=Inches(0.8); sec.bottom_margin=Inches(0.8); sec.left_margin=Inches(0.9); sec.right_margin=Inches(0.9)
styles=doc.styles
styles['Normal'].font.name='Calibri'; styles['Normal']._element.rPr.rFonts.set(qn('w:eastAsia'),'Microsoft YaHei'); styles['Normal'].font.size=Pt(10.5)
for name,size,color in [('Heading 1',16,'2E74B5'),('Heading 2',13,'2E74B5'),('Heading 3',11,'1F4D78')]:
    st=styles[name]; st.font.name='Calibri'; st._element.rPr.rFonts.set(qn('w:eastAsia'),'Microsoft YaHei'); st.font.size=Pt(size); st.font.color.rgb=RGBColor.from_string(color)

def shade(cell, fill):
    tcPr=cell._tc.get_or_add_tcPr(); shd=OxmlElement('w:shd'); shd.set(qn('w:fill'),fill); tcPr.append(shd)
def set_cell_text(cell,text,bold=False):
    cell.text=''; p=cell.paragraphs[0]; p.paragraph_format.space_after=Pt(2); r=p.add_run(text); r.bold=bold; r.font.name='Microsoft YaHei'; r._element.rPr.rFonts.set(qn('w:eastAsia'),'Microsoft YaHei'); r.font.size=Pt(9.5)

def add_bullet(text):
    p=doc.add_paragraph(style='List Bullet'); p.paragraph_format.space_after=Pt(3); p.add_run(text)

def add_para(text,bold=False):
    p=doc.add_paragraph(); p.paragraph_format.space_after=Pt(6); r=p.add_run(text); r.bold=bold; return p

for line in src.splitlines():
    if not line.strip(): continue
    if line.startswith('# '):
        p=doc.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; p.paragraph_format.space_after=Pt(12); r=p.add_run(line[2:]); r.bold=True; r.font.size=Pt(20); r.font.color.rgb=RGBColor(31,78,121)
    elif line.startswith('## '): doc.add_heading(line[3:],level=1)
    elif line.startswith('### '): doc.add_heading(line[4:],level=2)
    elif line.startswith('- '): add_bullet(line[2:])
    elif line.startswith('|'):
        # handled as a contiguous table below
        continue
    else: add_para(line)

# Rebuild tables from markdown blocks in source, inserted at end as dedicated appendix sections.
# Remove none: tables are placed after prose for clarity.
doc.add_heading('专家评分字段说明（表格版）', level=1)
rows=[('字段','填写要求'),('质量','0—100，目标声源音质与金标准的接近程度'),('干扰抑制','0—100，非目标声源残留越少分数越高'),('伪影控制','0—100，水声、机械声、颗粒感等算法伪影越少分数越高'),('整体可接受度','0—100，对该 15 秒片段作为可用结果的总体判断'),('问题起止时间','0—15 秒，开始时间必须早于结束时间'),('标准化标签','从当前声源对应的标签集中选择，可多选'),('自定义标签','仅描述本次评分的新问题，不直接修改标准标签库'),('主观可靠性','0—100，表示本次判断的把握程度')]
t=doc.add_table(rows=len(rows), cols=2); t.alignment=WD_TABLE_ALIGNMENT.CENTER; t.autofit=False
for i,row in enumerate(rows):
    for j,val in enumerate(row):
        c=t.cell(i,j); c.width=Inches(1.55 if j==0 else 4.25); c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER; set_cell_text(c,val,i==0)
        if i==0: shade(c,'E8EEF5')

doc.add_heading('真实试听记录表（建议模板）', level=1)
headers=['片段编号','声源','质量','干扰','伪影','可接受度','问题起止时间','标签','可靠性','备注']
t=doc.add_table(rows=2, cols=len(headers)); t.alignment=WD_TABLE_ALIGNMENT.CENTER; t.autofit=False
for j,h in enumerate(headers): set_cell_text(t.cell(0,j),h,True); shade(t.cell(0,j),'E8EEF5'); t.cell(0,j).width=Inches(0.63)
for j in range(len(headers)): set_cell_text(t.cell(1,j),'',False); t.cell(1,j).width=Inches(0.63)

footer=sec.footer.paragraphs[0]; footer.alignment=WD_ALIGN_PARAGRAPH.RIGHT; footer.add_run('AudioLab 专利补充沟通材料').font.size=Pt(8)
out=Path('docs/老师沟通材料包.docx'); doc.save(out)
print(out)
