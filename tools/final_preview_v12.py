
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
BASE=r"G:\working\dsh_work\aokana-skin"; OUT=os.path.join(BASE,"docs","images")
h1=Image.open(os.path.join(BASE,"assets","h1","panel_h_zh_v12.png")).convert("RGBA").resize((1428,302),Image.LANCZOS)
ball=Image.open(os.path.join(BASE,"assets","icons","v04","cn1.png")).convert("RGBA").resize((112,112),Image.LANCZOS)
W,H=1800,800
bg=Image.new("RGB",(W,H)); d=ImageDraw.Draw(bg)
top=(214,238,226); bot=(150,196,164)
for y in range(H):
    t=y/(H-1); d.line([(0,y),(W,y)],fill=tuple(int(top[i]+(bot[i]-top[i])*t) for i in range(3)))
band=Image.new("RGBA",(W,H),(0,0,0,0)); bd=ImageDraw.Draw(band)
for i in range(-6,18):
    x=i*150; bd.polygon([(x,0),(x+60,0),(x+60+380,H),(x+380,H)],fill=(40,90,60,42))
band=band.filter(ImageFilter.GaussianBlur(28)); bg=Image.alpha_composite(bg.convert("RGBA"),band).convert("RGBA")
sh=Image.new("RGBA",(W,H),(0,0,0,0)); sd=ImageDraw.Draw(sh)
sd.rounded_rectangle([158,118,158+1428+4,118+302+8],radius=32,fill=(30,60,80,45))
sh=sh.filter(ImageFilter.GaussianBlur(28)); bg.alpha_composite(sh)
bg.alpha_composite(h1,(160,120)); bg.alpha_composite(ball,(160+1428-112-8,470))
d=ImageDraw.Draw(bg)
f=ImageFont.truetype(r"C:\Windows\Fonts\msyhbd.ttc",34)
d.text((160+90,120+126),"ru'tu",font=f,fill=(110,110,110),anchor="ls")
items=[("如图",(42,147,198)),("入土",(110,110,110)),("乳突",(110,110,110)),("入图",(110,110,110)),("如荼",(110,110,110)),("如土",(110,110,110))]
x=160+90
for s,col in items:
    d.text((x,120+186),s,font=f,fill=col,anchor="ls"); x+=int(d.textlength(s,font=f))+30
cf=ImageFont.truetype(r"C:\Windows\Fonts\msyhbd.ttc",32); cf2=ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc",22)
d.text((160,600),"苍之彼方·四重奏（中文）· v0.12",font=cf,fill=(30,72,96))
d.text((160,645),"1:1 对话框复刻 · 0.85 倍紧凑窗口（714×151）· 不透明白面板 · 单球状态栏",font=cf2,fill=(80,116,136))
bg.convert("RGB").save(os.path.join(OUT,"final_preview_v12.png"))
print("saved")
