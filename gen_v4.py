#!/usr/bin/env python3
"""
FFT Nano ULTRA-VISIBLE Background Generator - Version 4
"""

from PIL import Image, ImageDraw
import os, math

W,H=3840,2160
C_L=(250,248,245); C_M=(240,235,224); C_D=(230,226,219)
ORANGE=(181,86,32); BLUE=(90,154,184); TAN=(235,225,210)

def lerp(c1,c2,t):
    return tuple(int(c1[i]+(c2[i]-c1[i])*t) for i in range(3))

def noise(img):
    import numpy as np
    a=np.array(img,float); a+=np.random.normal(0,1,a.shape)
    return Image.fromarray(np.clip(a,0,255).astype(np.uint8))

def hex_v4():
    print("V4: Ultra-visible hexagons...")
    img=Image.new('RGB',(W,H),C_M)
    d=ImageDraw.Draw(img)
    for y in range(H): d.line([(0,y),(W,y)],fill=lerp(C_L,C_D,y/H*0.4))
    
    size=120; hw=size*0.866; lw=5
    for r in range(int(H/hw)+2):
        for c in range(int(W/(size*1.5))+2):
            x=c*size*1.5; y=r*hw+(c%2)*hw/2
            pts=[(x+size*math.cos(math.pi/3*i), y+size*math.sin(math.pi/3*i)) for i in range(6)]
            for i in range(6): d.line([pts[i],pts[(i+1)%6]],fill=ORANGE,width=lw)
    return noise(img)

def terrain_v4():
    print("V4: Ultra-visible terrain contours...")
    img=Image.new('RGB',(W,H),C_M)
    d=ImageDraw.Draw(img)
    for y in range(H): d.line([(0,y),(W,y)],fill=lerp(C_L,C_D,y/H*0.35))
    
    levels=6; lw=6
    for l in range(levels):
        base_y=(l+1)*H/(levels+1)
        for x in range(0,W,5):
            wave=math.sin(x/120+l*1.2)*120 + math.sin(x/200+l*0.6)*80
            y=base_y+wave
            if x>0: d.line([(x-5,prev_y),(x,y)],fill=BLUE,width=lw)
            prev_y=y
    return noise(img)

def diamond_v4():
    print("V4: Ultra-visible diamond grid...")
    img=Image.new('RGB',(W,H),C_M)
    d=ImageDraw.Draw(img)
    for y in range(H): d.line([(0,y),(W,y)],fill=lerp(C_L,C_D,y/H*0.3))
    
    size=100; lw=5
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
                d.ellipse([ix-10,y-10,ix+10,y+10],fill=c)
    return noise(img)

def furrow_v4():
    print("V4: Ultra-visible furrow waves...")
    img=Image.new('RGB',(W,H),C_M)
    d=ImageDraw.Draw(img)
    for y in range(H): d.line([(0,y),(W,y)],fill=lerp(C_L,TAN,y/H*0.5))
    
    n=8; lw=6
    for i in range(n):
        base_y=(i+1)*H/(n+1)
        for x in range(0,W,5):
            wave=math.sin(x/150+i*0.7)*70 + math.sin(x/250-i*0.4)*40
            y=base_y+wave
            if x>0: d.line([(x-5,prev_y),(x,y)],fill=BLUE,width=lw)
            prev_y=y
    return noise(img)

OUT="/Users/scrimwiggins/clawd/fft-nano-work/assets/backgrounds"
os.makedirs(OUT,exist_ok=True)
for fn,fn_gen in [("bg-hexagon-elegant-cream.png",hex_v4),("bg-terrain-farm-cream.png",terrain_v4),("bg-diamond-grid-cream.png",diamond_v4),("bg-furrow-waves-cream.png",furrow_v4)]:
    img=fn_gen()
    p=os.path.join(OUT,fn); img.save(p,"PNG")
    print(f"Saved {p} ({os.path.getsize(p)/1024:.0f}KB)")

print("Done!")
