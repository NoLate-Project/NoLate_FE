"""Generate white-only App Store artwork and an editable SVG Figma board.

App pixels are preserved native QA captures; surrounding artwork is vector-based.
Typography is outlined from the bundled OFL Pretendard fonts for portable import.
"""
from pathlib import Path
import base64
import html
import json
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

HERE = Path(__file__).resolve().parent
CAPTURES = HERE / 'source'
WHITE = '#F7F9FD'
INK = '#111827'
BLUE = '#0877F9'
MUTED = '#627087'
fonts = {name: TTFont(HERE / f'fonts/Pretendard-{name}.otf') for name in ['Bold', 'Regular']}

def text(value, x, y, size, color=INK, weight='Bold', tracking=-.025):
    font = fonts[weight]
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    units = font['head'].unitsPerEm
    scale = size / units
    cursor = x
    pieces = []
    for ch in value:
        glyph = cmap.get(ord(ch), '.notdef')
        pen = SVGPathPen(glyphs)
        glyphs[glyph].draw(pen)
        pieces.append(f'<path transform="translate({cursor:.2f} {y}) scale({scale:.7f} {-scale:.7f})" d="{pen.getCommands()}"/>')
        cursor += font['hmtx'][glyph][0] * scale + size * tracking
    return f'<g aria-label="{html.escape(value)}" fill="{color}">{"".join(pieces)}</g>'

def rect(x,y,w,h,r=0,fill=WHITE,extra=''):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" {extra}/>'

def image(path,x,y,w,h,extra=''):
    uri = 'data:image/png;base64,' + base64.b64encode(Path(path).read_bytes()).decode()
    return f'<image x="{x}" y="{y}" width="{w}" height="{h}" xlink:href="{uri}" preserveAspectRatio="none" {extra}/>'

asset = {
  'calendar':CAPTURES/'calendar.png',
  'list':CAPTURES/'list.png',
  'quick':CAPTURES/'quick.png',
  'preview':CAPTURES/'preview.png',
  'route':CAPTURES/'route.png',
  'details':CAPTURES/'details.png',
  'icon':HERE/'icon-256.png',
}
for path in asset.values():
    if not path.exists():
        raise FileNotFoundError(path)

counter=0
def uid():
    global counter
    counter+=1
    return 'n'+str(counter)

def crop(key,x,y,w,h,source_y,source_h,r=38,source_x=0):
    ident=uid()
    scale=h/source_h
    actual_w=1206*scale
    # Crops are honest windows into the original app capture, never redrawn UI.
    return (f'<g><defs><clipPath id="{ident}">{rect(x,y,w,h,r,"#fff")}</clipPath></defs>'
            +f'<g clip-path="url(#{ident})">'
            +image(asset[key],x-source_x*scale,y-source_y*scale,actual_w,2622*scale)+'</g></g>')

def phone(key,x,y,w,angle=0):
    h=w*2622/1206
    ident=uid()
    return (f'<g transform="rotate({angle} {x+w/2} {y+h/2})">'
      +rect(x-10,y-10,w+20,h+20,76,'#C5CEDA','filter="url(#shadow)"')
      +rect(x-5,y-5,w+10,h+10,72,'#1A2331')
      +f'<defs><clipPath id="{ident}">{rect(x,y,w,h,66,"#fff")}</clipPath></defs>'
      +image(asset[key],x,y,w,h,f'clip-path="url(#{ident})"')+'</g>')

def brand(x=78,y=66,size=54):
    return image(asset['icon'],x,y,size,size)+text('NoLate',x+size+16,y+size*.8,size*.7)

def headline(lines,y=286,size=108):
    return ''.join(text(line,76,y+i*size*1.19,size,BLUE if i==len(lines)-1 else INK) for i,line in enumerate(lines))

def caption(value):
    return text(value,79,514,39,MUTED,'Regular',0)

def base(content,w=1206,h=2622):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
      +'<defs><filter id="shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="24" stdDeviation="26" flood-color="#13264A" flood-opacity=".12"/></filter></defs>'
      +rect(0,0,w,h,0,WHITE)+content+'</svg>')

out=[]
def save(name,content,w=1206,h=2622):
    markup=base(content,w,h)
    (HERE/(name+'.svg')).write_text(markup)
    out.append({'name':name,'width':w,'height':h,'svg':markup})

# Preserve v2's white identity and factual copy; refine rhythm and feature focus.
c=brand()+headline(['약속을 적으면,','출발이 보여요.'])
c+=caption('일정·경로·추천 출발 시각을 한 번에.')
c+=phone('calendar',338,716,790,-3)
c+=rect(60,1710,1086,540,42,'#FFFFFF','filter="url(#shadow)"')
c+=crop('route',78,1734,1050,486,2040,558,28)
save('01-from-plan-to-departure',c)

c=brand()+headline(['생각난 약속,','한 문장이면 충분.'])
c+=caption('날짜·시간·장소를 알아서 정리해요.')
c+=rect(76,666,1054,180,32,'#EAF1FF')
c+=text('“내일 오후 2시, 성수 오피스에서 회의”',112,777,43,BLUE)
c+=phone('preview',186,884,834,1.5)
save('02-one-sentence-to-schedule',c)

c=brand()+headline(['가는 길도,','나설 시간도.'])
c+=caption('약속에 맞는 이동을 준비하세요.')
c+=rect(60,700,1086,1800,46,'#FFFFFF','filter="url(#shadow)"')
c+=crop('route',60,700,1086,1260,370,1400,46)
c+=crop('route',60,1994,1086,490,2040,544,36)
save('03-route-and-departure',c)

c=brand()+headline(['몇 시에 타고,','어디서 갈아탈지.'])
c+=caption('환승과 도보 구간을 순서대로 확인해요.')
c+=rect(66,700,1074,1618,42,'#FFFFFF','filter="url(#shadow)"')
c+=crop('details',66,700,1074,1618,800,1817,42)
c+=text('추천 출발부터 마지막 도보까지.',78,2454,39,MUTED,'Regular',0)
save('04-every-step-of-your-route',c)

c=brand()+headline(['다가올 약속이','한눈에, 내 방식대로.'],286,100)
c+=caption('캘린더와 목록으로 가볍게 확인하세요.')
c+=phone('calendar',-34,752,710,-3)
c+=phone('list',542,934,710,3)
save('05-calendar-and-list',c)

c=brand()+headline(['적고, 찍고, 말하고.','편한 대로 남겨요.'],286,100)
c+=caption('텍스트·사진·음성으로 빠르게 일정 만들기.')
# Enlarge the actual native input modal; do not duplicate its tabs in the artwork.
c+=rect(56,790,1094,1344,76,'#FFFFFF','filter="url(#shadow)"')
c+=crop('quick',56,790,1094,1344,199,1260,76,90)
save('06-capture-your-plans',c)

c=brand(190,130,110)+text('약속부터',190,650,265)+text('출발까지.',190,975,265,BLUE)
c+=text('일정 다음은, NoLate.',205,1175,80,MUTED,'Regular',0)
c+=phone('calendar',2590,115,710,4)
c+=rect(1700,920,1150,490,44,'#FFFFFF','filter="url(#shadow)"')
c+=crop('route',1720,940,1110,450,2040,488,32)
save('header-3840x1646',c,3840,1646)

c=brand(190,150,120)+text('일정 다음은,',190,770,278)+text('출발.',190,1120,278,BLUE)
c+=text('약속에 맞춰, 이동까지 준비하세요.',200,1350,76,MUTED,'Regular',0)
c+=phone('route',2290,380,1050,3)
save('search-3840x2560',c,3840,2560)

# A separate review board makes the alternatives reviewable in the native Figma app.
board_w=8200
board_h=5700
parts=[rect(0,0,board_w,board_h,0,'#E7ECF3'),text('NoLate 1.3.0 · WHITE v3 · 디테일 정리',120,170,80)]
parts+=[text('화이트·블루 유지 / 제목과 설명 간격 / 기울기 절제 / 실제 앱 화면의 기능 확대',124,270,38,MUTED,'Regular',0)]
for i,item in enumerate(out[:6]):
    inner=item['svg'].split('>',1)[1].rsplit('</svg>',1)[0]
    clip='board-panel-'+str(i)
    parts.append(f'<g id="{item["name"]}" transform="translate({120+i*1330} 430)"><defs><clipPath id="{clip}">{rect(0,0,item["width"],item["height"],0,"#fff")}</clipPath></defs><g clip-path="url(#{clip})">{inner}</g></g>')
for i,item in enumerate(out[6:]):
    inner=item['svg'].split('>',1)[1].rsplit('</svg>',1)[0]
    clip='board-creative-'+str(i)
    parts.append(f'<g id="{item["name"]}" transform="translate({120+i*4050} 3240)"><defs><clipPath id="{clip}">{rect(0,0,item["width"],item["height"],0,"#fff")}</clipPath></defs><g clip-path="url(#{clip})">{inner}</g></g>')
board='<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="8200" height="5850" viewBox="0 0 8200 5850">'+''.join(parts)+'</svg>'
(HERE/'NoLate-1.3.0-white-refined-board.svg').write_text(board)
(HERE/'design-source.json').write_text(json.dumps({
 'theme':'white-only','revision':'v3-refined','font':'Pretendard Bold / Regular',
 'reference_urls':['https://dribbble.com/shots/27273314-App-Store-Screenshots-Amie-Todos-calendar','https://apps.apple.com/us/app/structured-daily-planner-todo/id1499198946'],
 'app_captures':{k:str(v.relative_to(HERE)) for k,v in asset.items()},
 'capture_note':'Native QA captures dated 2026-10-12/13; demo data. No release build verification implied.',
 'assets':[{k:v for k,v in x.items() if k!='svg'} for x in out],
},ensure_ascii=False,indent=2)+'\n')
print('Generated',len(out),'SVG assets and an editable Figma board in',HERE)
