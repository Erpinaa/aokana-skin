
import os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
BASE=r"G:\working\dsh_work\aokana-skin"
OUT=os.path.join(BASE,"assets")
for d in [os.path.join(OUT,"h1"),os.path.join(OUT,"icons","v03"),os.path.join(OUT,"statusbar")]:
    os.makedirs(d,exist_ok=True)
FONT=r"C:\Windows\Fonts\NotoSansSC-VF.ttf"
def font(sz,bold=True):
    f=ImageFont.truetype(FONT,sz)
    try:
        if bold: f.set_variation_by_name("Bold")
    except Exception: pass
    return f

def opaque_panel(src,out,rect,radius):
    im=Image.open(src).convert("RGBA")
    W,H=im.size; S=4
    m=Image.new("L",(W*S,H*S),0); d=ImageDraw.Draw(m)
    d.rounded_rectangle([rect[0]*S,rect[1]*S,rect[2]*S,rect[3]*S],radius=radius*S,fill=255)
    m=m.resize((W,H),Image.LANCZOS)
    a=np.array(im).astype(np.float32)
    mm=np.array(m).astype(np.float32)/255.0
    a[:,:,3]=np.clip(255*mm + a[:,:,3]*(1-mm),0,255)
    Image.fromarray(a.astype(np.uint8),"RGBA").save(out)
    print("opaque",os.path.basename(out),im.size)

# H1: 2x canvas 1680x356, panel x33..1660.6 y89.6..331.4 r20.4
for suf in ["zh","en","sp"]:
    opaque_panel(os.path.join(BASE,"docs","images",f"skin_h1_asset_2x_{suf}.png"),
                 os.path.join(OUT,"h1",f"panel_h_{suf}_v03.png"),
                 (33.0,89.6,1660.6,331.4),20.4)
# V1: 2x 522x428, panel x12..510 y88..412 r20
for suf,fn in [("zh","panel_v.png"),("en","panel_v_en.png"),("sp","panel_v_sp.png")]:
    opaque_panel(os.path.join(OUT,"v1",fn),
                 os.path.join(OUT,"v1",f"panel_v_{suf}_v03.png"),
                 (12,88,510,412),20)

def ball(size=112, text="中", top=(87,208,254), bot=(61,176,237)):
    S=4; W=size*S
    img=Image.new("RGBA",(W,W),(0,0,0,0)); d=ImageDraw.Draw(img)
    cx=cy=size/2; pad=8; r=size/2-pad
    sh=Image.new("RGBA",(W,W),(0,0,0,0)); sd=ImageDraw.Draw(sh)
    sd.ellipse([(cx-r)*S,(cy-r+3)*S,(cx+r)*S,(cy+r+3)*S],fill=(20,60,90,60))
    sh=sh.filter(ImageFilter.GaussianBlur(4.4*S)); img.alpha_composite(sh)
    grad=Image.new("RGB",(W,W)); gd=ImageDraw.Draw(grad)
    for y in range(W):
        t=y/(W-1); gd.line([(0,y),(W,y)],fill=tuple(int(top[i]+(bot[i]-top[i])*t) for i in range(3)))
    gm=Image.new("L",(W,W),0); ImageDraw.Draw(gm).ellipse([(cx-r)*S,(cy-r)*S,(cx+r)*S,(cy+r)*S],fill=255)
    img.paste(grad,(0,0),gm)
    hi=Image.new("RGBA",(W,W),(0,0,0,0)); hd=ImageDraw.Draw(hi)
    hd.arc([(cx-r)*S+4*S,(cy-r)*S+4*S,(cx+r)*S-4*S,(cy+r)*S-4*S],200,340,fill=(255,255,255,55),width=3*S)
    img.alpha_composite(hi)
    d=ImageDraw.Draw(img)
    f=font(int(size*0.40*S))
    d.text((cx*S,cy*S-1*S),text,font=f,fill=(255,255,255,255),anchor="mm")
    return img.resize((size,size),Image.LANCZOS)

variants=[("cn","中"),("en","英"),("a","A")]
for key,text in variants:
    ball(112,text,(87,208,254),(61,176,237)).save(os.path.join(OUT,"icons","v03",f"{key}1.png"))
    ball(112,text,(104,211,250),(76,195,247)).save(os.path.join(OUT,"icons","v03",f"{key}2.png"))
    ball(112,text,(53,168,214),(46,154,200)).save(os.path.join(OUT,"icons","v03",f"{key}3.png"))
print("icons saved")
# transparent bar 128x128
Image.new("RGBA",(128,128),(0,0,0,0)).save(os.path.join(OUT,"statusbar","bar_v03.png"))
print("bar saved")
