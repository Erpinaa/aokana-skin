
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
BASE=r"G:\working\dsh_work\aokana-skin"
OUT=os.path.join(BASE,"docs","images"); os.makedirs(OUT,exist_ok=True)
FONT_PATH=r"C:\Windows\Fonts\NotoSansSC-VF.ttf"
# 1x skin geometry, scale s from 1480x314
S=840/1480.0
def sc(v): return v*S
PLATE=(sc(11),sc(14),sc(415),sc(77)); PLATE_R=sc(31.5)
TAIL=[(sc(85),sc(77)),(sc(110),sc(77)),(sc(95),sc(89))]
PANEL=(sc(29),sc(79),sc(1463),sc(292)); PANEL_R=sc(18)
LINE1,LINE2,LINE_TH=sc(155),sc(214),sc(2.5)
NAME_C=(sc(229),sc(46)); NAME_SIZE=sc(34)
DOTS=[(sc(48),sc(37)),(sc(64),sc(37)),(sc(48),sc(53)),(sc(64),sc(53))]; DOT_R=sc(3.5)
def load_font(size):
    f=ImageFont.truetype(FONT_PATH,size)
    try: f.set_variation_by_name("Bold")
    except Exception: pass
    return f
def gradient_row(width,stops):
    out=np.zeros((width,3),np.float32); ts=np.linspace(0,1,width)
    for i in range(len(stops)-1):
        t0,c0=stops[i]; t1,c1=stops[i+1]
        m=(ts>=t0)&(ts<=t1); k=(ts[m]-t0)/max(1e-9,(t1-t0))
        for ch in range(3): out[m,ch]=c0[ch]+(c1[ch]-c0[ch])*k
    return out
def render(scale=8, W=840, H=178, name_text="中文"):
    w,h=int(W*scale),int(H*scale); Sf=lambda v:int(round(v*scale))
    img=Image.new("RGBA",(w,h),(0,0,0,0)); d=ImageDraw.Draw(img)
    d.rounded_rectangle([Sf(PANEL[0]),Sf(PANEL[1]),Sf(PANEL[2]),Sf(PANEL[3])],radius=Sf(PANEL_R),fill=(255,255,255,230))
    for y in (LINE1,LINE2):
        d.rectangle([Sf(PANEL[0]),Sf(y-LINE_TH/2),Sf(PANEL[2]),Sf(y+LINE_TH/2)],fill=(143,208,230,252))
    mask=Image.new("L",(w,h),0); md=ImageDraw.Draw(mask)
    md.rounded_rectangle([Sf(PLATE[0]),Sf(PLATE[1]),Sf(PLATE[2]),Sf(PLATE[3])],radius=Sf(PLATE_R),fill=255)
    md.polygon([(Sf(x),Sf(y)) for x,y in TAIL],fill=255)
    md.ellipse([Sf(sc(95)-1.2),Sf(sc(89)-1.2),Sf(sc(95)+1.2),Sf(sc(89)+1.2)],fill=255)
    pw=PLATE[2]-PLATE[0]
    stops=[(0.00,(89,211,255)),(0.36,(87,208,254)),(0.47,(80,199,249)),(0.62,(69,185,242)),(0.77,(61,176,237)),(1.00,(61,176,237))]
    gr=gradient_row(int(round(pw*scale)),stops)
    full=np.zeros((h,w,3),np.float32); x0=Sf(PLATE[0]); full[:,x0:x0+gr.shape[0],:]=gr[None,:,:]
    ys=np.linspace(0,1,h)[:,None,None]; full=full*(1.0-0.025*ys)
    plate=Image.fromarray(np.clip(full,0,255).astype(np.uint8),"RGB").convert("RGBA"); plate.putalpha(mask)
    img.alpha_composite(plate)
    d=ImageDraw.Draw(img)
    nf=load_font(Sf(NAME_SIZE))
    d.text((Sf(NAME_C[0]),Sf(NAME_C[1])),name_text,font=nf,fill=(255,255,255,255),anchor="mm")

    return img
ASSETS={}
for _label,_suffix in [("中文","zh"),("英文","en"),("双拼","sp")]:
    big=render(8, name_text=_label)
    asset2=big.resize((1680,356),Image.LANCZOS)
    # paste original dot cluster at 2x
    _dc=Image.open(os.path.join(BASE,"ref","dots_user.png")).convert("RGB")
    _k=1680/1480
    _dw,_dh=int(round(49*0.7*_k)),int(round(51*0.7*_k))
    _dp=_dc.resize((_dw,_dh),Image.LANCZOS)
    _dm=Image.new("L",(_dw,_dh),0); ImageDraw.Draw(_dm).rounded_rectangle([2,2,_dw-3,_dh-3],radius=7,fill=255)
    _dm=_dm.filter(ImageFilter.GaussianBlur(2))
    asset2.paste(_dp,(int(round(40.4*_k)),int(round(27.5*_k))),_dm)
    asset2.save(os.path.join(OUT,f"skin_h1_asset_2x_{_suffix}.png"))
    asset1=asset2.resize((840,178),Image.LANCZOS)
    asset1.save(os.path.join(OUT,f"skin_h1_asset_1x_{_suffix}.png"))
    ASSETS[_suffix]=(asset2,asset1)
ASSETS["zh"][0].save(os.path.join(OUT,"skin_h1_asset_2x.png"))
ASSETS["zh"][1].save(os.path.join(OUT,"skin_h1_asset_1x.png"))
asset2=ASSETS["zh"][0]
print("assets saved")

# nameplate variants sheet
nv=Image.new("RGB",(3*500+40,170),(245,250,252)); nd=ImageDraw.Draw(nv)
_vf=ImageFont.truetype(r"C:\Windows\Fonts\msyhbd.ttc",24)
for _i,(_label,_suffix) in enumerate([("中文","zh"),("英文","en"),("双拼","sp")]):
    _crop=ASSETS[_suffix][0].crop((0,0,480,100))
    _plate_bg=Image.new("RGBA",_crop.size,(232,244,248,255))
    _plate_bg.alpha_composite(_crop)
    nv.paste(_plate_bg.convert("RGB"),(10+_i*500,50))
    nd.text((10+_i*500,18),_label,font=_vf,fill=(30,72,96))
nv.save(os.path.join(OUT,"nameplate_variants.png"))

# mockup
bg=Image.new("RGB",(2000,900)); d=ImageDraw.Draw(bg)
top=(214,238,226); bot=(150,196,164)
for y in range(900):
    t=y/899; d.line([(0,y),(2000,y)],fill=tuple(int(top[i]+(bot[i]-top[i])*t) for i in range(3)))
# bamboo-like diagonal bands
band=Image.new("RGBA",(2000,900),(0,0,0,0)); bd=ImageDraw.Draw(band)
for i in range(-6,18):
    x=i*150
    bd.polygon([(x,0),(x+60,0),(x+60+380,900),(x+380,900)],fill=(40,90,60,42))
band=band.filter(ImageFilter.GaussianBlur(28)); bg=Image.alpha_composite(bg.convert("RGBA"),band)
# cream light patch right
cream=Image.new("RGBA",(2000,900),(0,0,0,0)); cd=ImageDraw.Draw(cream)
cd.ellipse([1350,-250,2300,700],fill=(254,234,199,170))
cream=cream.filter(ImageFilter.GaussianBlur(70)); bg=Image.alpha_composite(bg,cream).convert("RGB")
# shadow
sh=Image.new("RGBA",(2000,900),(0,0,0,0)); sd=ImageDraw.Draw(sh)
sd.rounded_rectangle([158,198,158+1680+4,198+356+8],radius=36,fill=(30,60,80,45))
sh=sh.filter(ImageFilter.GaussianBlur(30)); bg=bg.convert("RGBA"); bg.alpha_composite(sh)
bg.alpha_composite(asset2,(160,200))
d=ImageDraw.Draw(bg)
# sample text at 2x (font 40)
f_pin=load_font(40); f_cand=load_font(40)
d.text((160+106,200+156),"cang zhi bi fang",font=f_pin,fill=(110,110,110),anchor="ls")
items=[("苍之彼方的四重奏",(61,176,237)),("苍之彼方",(110,110,110)),("苍彼",(110,110,110)),("苍穹",(110,110,110))]
x=160+106
for s,col in items:
    d.text((x,200+222),s,font=f_cand,fill=col,anchor="ls")
    x+=int(d.textlength(s,font=f_cand))+42
# caption
cf=ImageFont.truetype(r"C:\Windows\Fonts\msyhbd.ttc",34)
cf2=ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc",24)
d.text((160,610),"名牌显示当前输入模式，第一行是拼音，第二行是候选",font=cf,fill=(30,72,96))
d.text((160,660),"中/英/拼为三套底图；状态栏的中/英图标仍是真实模式开关。",font=cf2,fill=(80,116,136))
bg.convert("RGB").save(os.path.join(OUT,"mockup_h1_v2.png"))
print("mockup saved")
