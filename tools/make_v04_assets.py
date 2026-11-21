
import os
from PIL import Image, ImageFilter
BASE=r"G:\working\dsh_work\aokana-skin"; A=os.path.join(BASE,"assets")
for d in [os.path.join(A,"h1"),os.path.join(A,"v1"),os.path.join(A,"icons","v04"),os.path.join(A,"statusbar")]:
    os.makedirs(d,exist_ok=True)
def sharpen(src,size,out):
    im=Image.open(src).convert("RGBA").resize(size,Image.LANCZOS)
    rgb=im.convert("RGB").filter(ImageFilter.UnsharpMask(radius=0.8,percent=65,threshold=2))
    res=rgb.convert("RGBA"); res.putalpha(im.getchannel("A"))
    res.save(out)
    print(os.path.basename(out),res.size)
for s in ["zh","en","sp"]:
    sharpen(os.path.join(A,"h1",f"panel_h_{s}_v03.png"),(840,178),os.path.join(A,"h1",f"panel_h_{s}_v04.png"))
    sharpen(os.path.join(A,"v1",f"panel_v_{s}_v03.png"),(261,214),os.path.join(A,"v1",f"panel_v_{s}_v04.png"))
for k in ["cn1","cn2","cn3","en1","en2","en3","a1","a2","a3"]:
    sharpen(os.path.join(A,"icons","v03",f"{k}.png"),(56,56),os.path.join(A,"icons","v04",f"{k}.png"))
Image.new("RGBA",(64,64),(0,0,0,0)).save(os.path.join(A,"statusbar","bar_v04.png"))
print("bar_v04")
