
import os, json, shutil
from PIL import Image, ImageFilter
BASE=r"G:\working\dsh_work\aokana-skin"; A=os.path.join(BASE,"assets")
K=0.85
def resharpen(src,size,out):
    im=Image.open(src).convert("RGBA").resize(size,Image.LANCZOS)
    rgb=im.convert("RGB").filter(ImageFilter.UnsharpMask(radius=0.7,percent=55,threshold=2))
    r2=rgb.convert("RGBA"); r2.putalpha(im.getchannel("A"))
    r2.save(out); return r2.size
for s in ["zh","en","sp"]:
    h=resharpen(os.path.join(A,"h1",f"panel_h_{s}_v11.png"),(714,151),os.path.join(A,"h1",f"panel_h_{s}_v12.png"))
    v=resharpen(os.path.join(A,"v1",f"panel_v_{s}_v03.png"),(222,182),os.path.join(A,"v1",f"panel_v_{s}_v12.png"))
    print(s,h,v)
    for rel,fn in [(os.path.join("h1",f"panel_h_{s}_v12.png"),f"panel_h_{s}_v12.png"),(os.path.join("v1",f"panel_v_{s}_v12.png"),f"panel_v_{s}_v12.png")]:
        shutil.copyfile(os.path.join(A,rel), os.path.join(BASE,"build",f"aokana-{s}","assets",rel))
    p=os.path.join(BASE,"build",f"aokana-{s}","skin.project.json")
    j=json.load(open(p,encoding="utf-8"))
    j["roles"]["panel_h"]["source"]=f"assets/h1/panel_h_{s}_v12.png"
    j["roles"]["panel_v"]["source"]=f"assets/v1/panel_v_{s}_v12.png"
    j["roles"]["panel_h"]["margins"]={"pinyin_marge":[48,2,44,102],"zhongwen_marge":[12,7,44,102]}
    j["roles"]["panel_v"]["margins"]={"pinyin_marge":[52,7,15,15],"zhongwen_marge":[28,7,15,15]}
    j["nineSlice"]["panel_h"]={"left":201,"right":20,"top":37,"bottom":10}
    j["nineSlice"]["panel_v"]={"left":0,"right":0,"top":37,"bottom":5}
    j["display"]["fontSize"]=17
    j["skinVersion"]="1.10"
    j["info"]="《苍之彼方的四重奏》对话框风格候选窗 · v0.12 等比缩小0.85 + 隐藏展开/菜单按钮"
    json.dump(j,open(p,"w",encoding="utf-8"),ensure_ascii=False,indent=2)
    print("project",s,"updated")
