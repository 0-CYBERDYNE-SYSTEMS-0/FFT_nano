#!/usr/bin/env python3
"""
FFT Nano HIGHLY VISIBLE Background Generator - Version 3
Patterns must be CLEARLY VISIBLE & PERCEPTIBLE
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import os
import math

WIDTH, HEIGHT = 3840, 2160
CREAM_LIGHT = (250, 248, 245)
CREAM_MID = (240, 235, 224)
CREAM_DARK = (230, 226, 219)
BURNT_ORANGE = (181, 86, 32)
POWDER_BLUE = (90, 154, 184)
WARM_TAN = (235, 225, 210)

def lerp(c1, c2, t):
    return (int(c1[0]+(c2[0]-c1[0])*t), int(c1[1]+(c2[1]-c1[1])*t), int(c1[2]+(c2[2]-c1[2])*t))

def noise(img, i=2):
    a=np.array(img,float); a+=np.random.normal(0,i,a.shape); return Image.fromarray(np.clip(a,0,255).astype(np.uint8))


def hex_v3():
    """VISIBLE hexagon - LARGER pattern, BOLDER lines"""
    print("V3: Large bold hexagons...")
    img=Image.new('RGB',(WIDTH,HEIGHT),CREAM_MID)
    d=ImageDraw.Draw(img)
    for y in range(HEIGHT): d.line([(0,y),(WIDTH,y)],fill=lerp(CREAM_LIGHT,CREAM_DARK,y/HEIGHT*0.4))
    
    size=150; h=size*1.732; w=4
    for row in range(int(HEIGHT/h)+2):
        for col in range(int(WIDTH/(size*1.5))+2):
            x=col*size*1.5; y=row*h+(col%2)*h/2
            pts=[(x+size*math.cos(math.pi/3*i), y+size*math.sin(math.pi/3*i)) for i in range(6)]
            for i in range(6): d.line([pts[i],pts[(i+1)%6]],fill=BURNT_ORANGE,width=w)
    return noise(img)


def terrain_v3():
    """VISIBLE terrain - LARGER waves, BOLDER lines"""
    print("V3: Large bold terrain contours...")
    img=Image.new('RGB',(WIDTH,HEIGHT),CREAM_MID)
    d=ImageDraw.Draw(img)
    for y in range(HEIGHT): d.line([(0,y),(WIDTH,y)],fill=lerp(CREAM_LIGHT,CREAM_DARK,y/HEIGHT*0.35))
    
    levels=8; w=4
    for lvl in range(levels):
        base_y=(lvl+1)*HEIGHT/(levels+1)
        pts=[]
        for x in range(0,WIDTH+10,10):
            wave=math.sin(x/150+lvl*1.0)*100 + math.sin(x/250+lvl*0.5)*60
            pts.append((x, base_y+wave))
        for i in range(len(pts)-1): d.line([pts[i],pts[i+1]],fill=POWDER_BLUE,width=w)
    return noise(img)


def diamond_v3():
    """VISIBLE diamond - LARGER, BOLDER"""
    print("V3: Large bold diamonds...")
    img=Image.new('RGB',(WIDTH,HEIGHT),CREAM_MID)
    d=ImageDraw.Draw(img)
    for y in range(HEIGHT): d.line([(0,y),(WIDTH,y)],fill=lerp(CREAM_LIGHT,CREAM_DARK,y/HEIGHT*0.3))
    
    size=120; w=4
    for i in range(-HEIGHT,WIDTH+HEIGHT,size):
        sx=max(0,i); sy=max(0,-i) if i<0 else 0; ex=min(WIDTH,i+HEIGHT); ey=min(HEIGHT,HEIGHT-i) if i>WIDTH-HEIGHT else HEIGHT
        if sx<WIDTH: d.line([(sx,sy),(ex,ey)],fill=BURNT_ORANGE,width=w)
    for i in range(0,WIDTH+HEIGHT,size):
        sx=min(WIDTH,i); sy=max(0,i-WIDTH); ex=max(0,i-HEIGHT); ey=min(HEIGHT,i)
        if sx>0: d.line([(sx,sy),(ex,ey)],fill=POWDER_BLUE,width=w)
    for x in range(0,WIDTH+size,size):
        for y in range(0,HEIGHT+size,size):
            ox=(y//size%2)*(size//2); ix=x+ox
            if 0<=ix<WIDTH:
                c=BURNT_ORANGE if (x//size+y//size)%2==0 else POWDER_BLUE
                d.ellipse([ix-7,y-7,ix+7,y+7],fill=c)
    return noise(img)


def furrow_v3():
    """VISIBLE furrows - LARGER waves, BOLDER lines"""
    print("V3: Large bold furrow waves...")
    img=Image.new('RGB',(WIDTH,HEIGHT),CREAM_MID)
    d=ImageDraw.Draw(img)
    for y in range(HEIGHT): d.line([(0,y),(WIDTH,y)],fill=lerp(CREAM_LIGHT,WARM_TAN,y/HEIGHT*0.5))
    
    n=10; w=4
    for i in range(n):
        base_y=(i+1)*HEIGHT/(n+1)
        pts=[]
        for x in range(0,WIDTH+8,8):
            wave=math.sin(x/180+i*0.5)*50 + math.sin(x/280-i*0.3)*30
            pts.append((x, base_y+wave))
        for j in range(len(pts)-1): d.line([pts[j],pts[j+1]],fill=POWDER_BLUE,width=w)
    return noise(img)


OUT="/Users/scrimwiggins/clawd/fft-nano-work/assets/backgrounds"
os.makedirs(OUT,exist_ok=True)

for fn,fn_gen in [("bg-hexagon-elegant-cream.png",hex_v3),("bg-terrain-farm-cream.png",terrain_v3),("bg-diamond-grid-cream.png",diamond_v3),("bg-furrow-waves-cream.png",furrow_v3)]:
    print(f"Generating {fn}...")
    img=fn_gen()
    p=os.path.join(OUT,fn); img.save(p,"PNG")
    print(f"  Saved: {p} ({os.path.getsize(p)/1024:.0f}KB)")

print("Done!")
