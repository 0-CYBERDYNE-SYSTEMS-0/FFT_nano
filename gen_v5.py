#!/usr/bin/env python3
"""FFT Nano FINAL VISIBLE Backgrounds"""

from PIL import Image, ImageDraw
import os, math

W,H=3840,2160
C_L=(250,248,245); C_D=(230,226,219); ORANGE=(181,86,32); BLUE=(90,154,184); TAN=(235,225,210)

def lerp(c1,c2,t): return tuple(int(c1[i]+(c2[i]-c1[i])*t) for i in range(3))
def noise(img):
    import numpy as np; a=np.array(img,float); a+=np.random.normal(0,1,a.shape); return Image.fromarray(np.clip(a,0,255).astype(np.uint8))

def hex_v5():
    print("V5: Final hexagon...")
    img=Image.new('RGB',(W,H),C_L)
    d=ImageDraw.Draw(img)
    for y in range(H): d.line([(0,y),(W,y)],fill=lerp(C_L,C_D,y/H*0.4))
    size=100; hw=size*0.866; lw=6
    for r in range(int(H/hw)+2):
        for c in range(int(W/(size*1.5))+2):
            x=c*size*1.5; y=r*hw+(c%2)*hw/2
            pts=[(x+size*math.cos(math.pi/3*i), y+size*math.sin(math.pi/3*i)) for i in range(6)]
            for i in range(6): d.line([pts[i],pts[(i+1)%6]],fill=ORANGE,width=lw)
    return noise(img)

def terrain_v5():
    print("V5: Final terrain - MUCH MORE VISIBLE...")
    img=Image.new('RGB',(W,H),C_L)
    d=ImageDraw.Draw(img)
    for y in range(H): d.line([(0,y),(W,y)],fill=lerp(C_L,C_D,y/H*0.35))
    # MORE contours, THICKER
    for l in range(10):
        base_y=(l+1)*H/11
        lw=5
        for x in range(0,W,3):
            wave=math.sin(x/100+l*0.9)*100 + math.sin(x/180+l*0.5)*70
            y=base_y+wave
            if x>0: d.line([(x-3,prev_y),(x,y)],fill=BLUE,width=lw)
            prev_y=y
    return noise(img)

def diamond_v5():
    print("V5: Final diamond...")
    img=Image.new('RGB',(W,H),C_L)
    d=ImageDraw.Draw(img)
    for y in range(H): d.line([(0,y),(W,y)],fill=lerp(C_L,C_D,y/H*0.3))
    size=90; lw=6
    for i in range(-H,W+H,size):
        sx=max(0,i); sy=max(0,-i) if i<0 else 0; ex=min(W,i+H); ey=min(H,H-i) if i>W-H else H
        if sx<W: d.line([(sx,sy),(ex,ey)],fill=ORANGE,width=lw)
    for i in range(0,W+H,size):
        sx=min(W,i); sy=max(0,i-W); ex=max(0,i-H); ey=min(H,i)
        if sx>0: d.line([(sx,sy),(ex,ey)],fill=BLUE,width=lw)
    for x in range(0,W+size,size):
        for y in range(0,H+size,size):
            ox=(y//size%2)*(size//2); ix=x+ox
            if 0<=ix<W:
                c=ORANGE if (x//size+y//size)%2==0 else BLUE
                d.ellipse([ix-12,y-12,ix+12,y+12],fill=c)
    return noise(img)

def furrow_v5():
    print("V5: Final furrow - MUCH MORE VISIBLE...")
    img=Image.new('RGB',(W,H),C_L)
    d=ImageDraw.Draw(img)
    for y in range(H): d.line([(0,y),(W,y)],fill=lerp(C_L,TAN,y/H*0.5))
    # MORE waves, THICKER
    for i in range(12):
        base_y=(i+1)*H/13
        lw=5
        for x in range(0,W,3):
            wave=math.sin(x/130+i*0.6)*60 + math.sin(x/220-i*0.35)*35
            y=base_y+wave
            if x>0: d.line([(x-3,prev_y),(x,y)],fill=BLUE,width=lw)
            prev_y=y
    return noise(img)

OUT="/Users/scrimwiggins/clawd/fft-nano-work/assets/backgrounds"
os.makedirs(OUT,exist_ok=True)
for fn,fn_gen in [("bg-hexagon-elegant-cream.png",hex_v5),("bg-terrain-farm-cream.png",terrain_v5),("bg-diamond-grid-cream.png",diamond_v5),("bg-furrow-waves-cream.png",furrow_v5)]:
    img=fn_gen()
    p=os.path.join(OUT,fn); img.save(p,"PNG")
    print(f"Saved {p} ({os.path.getsize(p)/1024:.0f}KB)")

print("FINAL versions complete!")
