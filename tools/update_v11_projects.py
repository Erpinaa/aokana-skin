
import os, json, shutil
from PIL import Image, ImageDraw
BASE=r"G:\working\dsh_work\aokana-skin"; A=os.path.join(BASE,"assets")
for s in ["zh","en","sp"]:
    im=Image.open(os.path.join(A,"h1",f"panel_h_{s}_v04.png")).convert("RGBA")
    # slice around line 1 (center y=88): rows 84..92, full panel width
    line_slice=im.crop((16,84,832,92))
    d=ImageDraw.Draw(im)
    # erase old line 2 (around 121.5)
    d.rectangle([16,116,831,127], fill=(255,255,255,255))
    # paste line-1 slice so its center lands at y=128 (slice center 88 -> paste y=124)
    im.paste(line_slice,(16,124))
    im.save(os.path.join(A,"h1",f"panel_h_{s}_v11.png"))
    shutil.copyfile(os.path.join(A,"h1",f"panel_h_{s}_v11.png"),
                    os.path.join(BASE,"build",f"aokana-{s}","assets","h1",f"panel_h_{s}_v11.png"))
    p=os.path.join(BASE,"build",f"aokana-{s}","skin.project.json")
    j=json.load(open(p,encoding="utf-8"))
    j["roles"]["panel_h"]["source"]=f"assets/h1/panel_h_{s}_v11.png"
    j["skinVersion"]="1.9"
    j["info"]="《苍之彼方的四重奏》对话框风格候选窗 · v0.11 第二条线 y=128，样式复制第一条"
    json.dump(j,open(p,"w",encoding="utf-8"),ensure_ascii=False,indent=2)
    print("updated",s)
