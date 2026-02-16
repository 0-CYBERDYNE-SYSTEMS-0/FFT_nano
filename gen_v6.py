#!/usr/bin/env python3
"""FFT Nano FINAL V6 - Darker blue for visibility"""

from PIL import Image, ImageDraw
import os, math

W,H=3840,2160
C_L=(250,248,245); C_D=(230,226,219); ORANGE=(181,86,32)
BLUE=(60,120,160)  # Darker powder blue for visibility
TAN=(235,225,210)

def lerp(c1,c2,t): return tuple(int(c1[i]+(c2[i]-c1[i])*t) for i in range(3))
def noise(img):
    import numpy as np; a=np.array(img,float); a+=np.random.normal(0,1,a.shape); return Image.fromarray(np.clip(a,0,255).astype(np.uint8))

def terrain_v6():
    print("V6: Terrain with DARKER blue...")
    img=Image.new('RGB',(W,H),C_L)
    d=ImageDraw.Draw(img)
    for y in range(H): d.line([(0,y),(W,y)],fill=lerp(C_L,C_D,y/H*0.35))
    for l in range(12):  # More contours
        base_y=(l+1)*H/13
        lw=6  # Thicker
        for x in range(0,W,3):
            wave=math.sin(x/100+l*0.8)*90 + math.sin(x/170+l*0.45)*60
            y=base_y+wave
            if x>0: d.line([(x-3,prev_y),(x,y)],fill=BLUE,width=lw)
            prev_y=y
    return noise(img)

def furrow_v6():
    print("V6: Furrow with DARKER blue...")
    img=Image.new('RGB',(W,H),C_L)
    d=ImageDraw.Draw(img)
    for y in range(H): d.line([(0,y),(W,y)],fill=lerp(C_L,TAN,y/H*0.5))
    for i in range(14):  # More waves
        base_y=(i+1)*H/15
        lw=6  # Thicker
        for x in range(0,W,3):
            wave=math.sin(x/120+i*0.5)*55 + math.sin(x/200-i*0.3)*30
            y=base_y+wave
            if x>0: d.line([(x-3,prev_y),(x,y)],fill=BLUE,width=lw)
            prev_y=y
    return noise(img)

OUT="/Users/scrimwiggins/clawd/fft-nano-work/assets/backgrounds"
os.makedirs(OUT,exist_ok=True)
for fn,fn_gen in [("bg-terrain-farm-cream.png",terrain_v6),("bg-furrow-waves-cream.png",furrow_v6)]:
    img=fn_gen()
    p=os.path.join(OUT,fn); img.save(p,"PNG")
    print(f"Saved {p} ({os.path.getsize(p)/1024:.0f}KB)")

print("Done!")
