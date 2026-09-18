/*!
 * raycaster.js — standalone DDA raycasting engine for grid-based dungeons
 * Extracted from "Depths of Dreadmoor". Zero dependencies, no build step.
 *
 * Renders a first-person 3D view of a 2D tile grid into a <canvas> using
 * classic DDA (Digital Differential Analysis) raycasting — one ray per
 * screen column, textured walls with correct perspective, optional
 * textured floor/ceiling, split-opening doors, illusionary walls, and a
 * per-column/per-row lookup-table optimization so the only trig calls
 * per frame are two (cos/sin of the player's facing angle).
 *
 * This module owns no game state — no player object, no inventory, no
 * animation timers. Each call to render() takes the current position/
 * angle/map as plain arguments and draws one frame; a caller that wants
 * smooth turning/movement should interpolate x/y/angle itself between
 * calls (Depths of Dreadmoor does this with its own ease-in-out timers —
 * that logic isn't part of this file, since it's a game-UI concern, not
 * a rendering one).
 *
 * ── Usage (plain <script>, no bundler) ─────────────────────────────────
 *   <canvas id="view" width="640" height="480"></canvas>
 *   <script src="raycaster.js"></script>
 *   <script>
 *     const rc = Raycaster.create(document.getElementById('view'));
 *     rc.resize(viewportEl.clientWidth, viewportEl.clientHeight); // on load + on resize
 *
 *     function frame(){
 *       rc.render({
 *         map: dungeon.map, mapW: 31, mapH: 31,
 *         x: player.x + 0.5, y: player.y + 0.5, // tile (x,y)'s CENTER — see note below
 *         angle: player.angle,                  // radians, 0 = +X axis
 *       });
 *       requestAnimationFrame(frame);
 *     }
 *     frame();
 *   </script>
 *
 * ── Usage (Node / bundlers / ES module via require) ───────────────────
 *   const Raycaster = require('./raycaster.js');
 *   const rc = Raycaster.create(canvas);
 *
 * ── Coordinate convention ───────────────────────────────────────────────
 * x/y are continuous world coordinates where integers fall on tile
 * CORNERS — so tile (mapX, mapY)'s center is (mapX+0.5, mapY+0.5). angle
 * is radians, increasing counter-clockwise from the +X axis, matching
 * Math.cos/Math.sin directly (angle 0 looks along +X, PI/2 looks along
 * +Y). map[y][x] is a tile-type integer read via the `tiles` option
 * below (or Raycaster.TILE's defaults, chosen to match the sibling
 * dungeon-generator.js addon so the two drop in together).
 *
 * ── Textures ────────────────────────────────────────────────────────────
 * Pass plain ImageData-shaped objects — {width, height, data} where data
 * is a flat RGBA Uint8ClampedArray, exactly what
 * `ctx.getImageData(0,0,w,h)` returns. Load an <img> into an offscreen
 * canvas and call getImageData() to produce one; any texture you omit
 * falls back to a flat shaded color for that tile type instead of
 * failing.
 */
(function(root, factory){
  if(typeof module==='object'&&module.exports){module.exports=factory();}
  else{root.Raycaster=factory();}
})(typeof self!=='undefined'?self:this, function(){
  'use strict';

  // Matches dungeon-generator.js's TILE values by default. Override per
  // instance via options.tiles if your map uses different numbers.
  const TILE={FLOOR:0,WALL:1,STAIRS_DOWN:2,STAIRS_UP:3,DOOR:4,ILLUSION:5,PIT:6};

  function clamp(v,lo,hi){return v<lo?lo:v>hi?hi:v;}

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   * @param {number} [options.fov=Math.PI/3] - horizontal field of view, radians
   * @param {number} [options.aspect=4/3] - resize() fits the largest box at this aspect ratio
   * @param {number} [options.fogDistance=14] - tiles beyond this render as flat fog/background
   * @param {boolean} [options.flicker=true] - subtle per-frame torchlight brightness jitter
   * @param {{FLOOR,WALL,STAIRS_DOWN,STAIRS_UP,DOOR,ILLUSION,PIT}} [options.tiles] - tile-value overrides
   */
  function create(canvas,options){
    options=options||{};
    const ctx=canvas.getContext('2d');
    const FOV=options.fov||Math.PI/3;
    const ASPECT=options.aspect||4/3;
    const FOG_DIST=options.fogDistance!=null?options.fogDistance:14;
    const FLICKER=options.flicker!==false;
    const T=Object.assign({},TILE,options.tiles||{});

    let CW=canvas.width||2,CH=canvas.height||2;

    let _frameBuf=null,_frameBufW=0,_frameBufH=0;
    function getFrameBuffer(){
      if(!_frameBuf||_frameBufW!==CW||_frameBufH!==CH){
        _frameBuf=ctx.createImageData(CW,CH);
        _frameBufW=CW;_frameBufH=CH;
      }
      return _frameBuf;
    }

    // Per-column ray-offset table: each column's angle offset from the
    // camera's facing direction depends only on screen geometry (CW,
    // FOV), never on position/rotation, so cos()/sin() for it are
    // computed once here and combined with the per-frame facing angle via
    // the angle-addition identities (2 multiplies + an add per column
    // instead of a fresh trig call) — rebuilt only when CW actually
    // changes (i.e. on resize), never on every render() call.
    let _rayCos=null,_raySin=null,_rayTableW=0;
    function getRayTable(){
      if(!_rayCos||_rayTableW!==CW){
        _rayCos=new Float64Array(CW);_raySin=new Float64Array(CW);
        for(let col=0;col<CW;col++){
          const off=-FOV/2+(col/CW)*FOV;
          _rayCos[col]=Math.cos(off);_raySin[col]=Math.sin(off);
        }
        _rayTableW=CW;
      }
      return {cosT:_rayCos,sinT:_raySin};
    }

    // Row-distance table for the optional textured floor/ceiling: every
    // pixel in a given screen row shares one perpendicular distance to
    // the floor/ceiling plane (depends only on the row's y and CH), and
    // it's symmetric about the horizon, so one table covers both the
    // ceiling and its mirrored floor row. Rebuilt only when CH changes.
    let _rowDist=null,_rowTableH=0;
    function getRowDistTable(){
      if(!_rowDist||_rowTableH!==CH){
        _rowDist=new Float64Array(CH);
        const half=CH/2;
        for(let y=0;y<CH;y++){
          const d=Math.abs(y-half);
          _rowDist[y]=d<0.5?1e6:half/d;
        }
        _rowTableH=CH;
      }
      return _rowDist;
    }

    /** Fit the canvas to the largest box of the configured aspect ratio within (availW, availH) CSS pixels. */
    function resize(availW,availH){
      if(!availW||!availH)return;
      let w=availW,h=Math.round(w/ASPECT);
      if(h>availH){h=availH;w=Math.round(h*ASPECT);}
      w=Math.max(2,w&~1);h=Math.max(2,h&~1); // even numbers, clean pixel layout
      if(canvas.width===w&&canvas.height===h)return;
      canvas.width=w;canvas.height=h;
      CW=w;CH=h;
    }

    /**
     * Render one frame.
     * @param {object} state
     * @param {number[][]} state.map - state.map[y][x] is a TILE.* value
     * @param {number} state.mapW
     * @param {number} state.mapH
     * @param {number} state.x - world x (see coordinate convention above)
     * @param {number} state.y - world y
     * @param {number} state.angle - facing angle, radians
     * @param {object} [state.textures] - {wall, door, stairsUp, stairsDown, floor} ImageData-shaped, all optional
     * @param {boolean} [state.texturesEnabled=true] - false forces flat shaded fallback colors even if textures are supplied
     * @param {boolean} [state.floorCeilingEnabled=false] - texture the floor/ceiling using textures.floor (or textures.wall if floor is omitted); otherwise a flat fill
     * @param {[number,number,number]} [state.fillColor=[0,0,0]] - flat background/fog color, RGB 0-255
     * @param {Object.<string,{offset:number}>} [state.doorStates] - "x,y" -> {offset: 0..0.5} for split-opening doors; a door tile with no entry here renders fully closed
     */
    function render(state){
      const map=state.map,MW=state.mapW,MH=state.mapH;
      const px=state.x,py=state.y,pa=state.angle;
      const textures=state.textures||{};
      const texturesEnabled=state.texturesEnabled!==false;
      const floorCeilingEnabled=!!state.floorCeilingEnabled;
      const fill=state.fillColor||[0,0,0];
      const doorStates=state.doorStates||{};

      const imgData=getFrameBuffer();
      const buf=imgData.data;

      const flicker=FLICKER?0.88+Math.random()*0.12:1;

      const {cosT:rayCosT,sinT:raySinT}=getRayTable();
      const cosPA=Math.cos(pa),sinPA=Math.sin(pa);

      const floorTex=textures.floor||textures.wall;
      if(floorCeilingEnabled&&floorTex){
        // Textured floor/ceiling — cast per ROW instead of per column,
        // since every pixel in a row shares one world-space sweep.
        const rowDistT=getRowDistTable();
        const tW=floorTex.width,tH=floorTex.height,td=floorTex.data;
        const rcL=rayCosT[0],rsL=raySinT[0],rcR=rayCosT[CW-1],rsR=raySinT[CW-1];
        const cosL=cosPA*rcL-sinPA*rsL,sinL=sinPA*rcL+cosPA*rsL;
        const cosR=cosPA*rcR-sinPA*rsR,sinR=sinPA*rcR+cosPA*rsR;
        for(let y=0;y<CH;y++){
          const rowDist=rowDistT[y];
          if(rowDist>FOG_DIST){
            for(let x=0;x<CW;x++){const i=(y*CW+x)*4;buf[i]=fill[0];buf[i+1]=fill[1];buf[i+2]=fill[2];buf[i+3]=255;}
            continue;
          }
          const floorX0=cosL*rowDist,floorY0=sinL*rowDist;
          const stepX=(cosR-cosL)*rowDist/CW,stepY=(sinR-sinL)*rowDist/CW;
          let fx=px+floorX0,fy=py+floorY0;
          const rowShade=clamp(flicker/(rowDist*0.35),0.06,1.0)*clamp(1-rowDist/FOG_DIST,0.04,1.0);
          for(let x=0;x<CW;x++){
            const i=(y*CW+x)*4;
            const tileX=fx|0,tileY=fy|0;
            if(tileX>=0&&tileX<MW&&tileY>=0&&tileY<MH){
              const tPX=(((fx-tileX)*tW)|0),tPY=(((fy-tileY)*tH)|0);
              const tIdx=((tPY<0?0:tPY>=tH?tH-1:tPY)*tW+(tPX<0?0:tPX>=tW?tW-1:tPX))*4;
              buf[i]=td[tIdx]*rowShade;buf[i+1]=td[tIdx+1]*rowShade;buf[i+2]=td[tIdx+2]*rowShade;buf[i+3]=255;
            } else {
              buf[i]=fill[0];buf[i+1]=fill[1];buf[i+2]=fill[2];buf[i+3]=255;
            }
            fx+=stepX;fy+=stepY;
          }
        }
      } else {
        for(let y=0;y<CH;y++){
          for(let x=0;x<CW;x++){const i=(y*CW+x)*4;buf[i]=fill[0];buf[i+1]=fill[1];buf[i+2]=fill[2];buf[i+3]=255;}
        }
      }

      // === CAST ONE RAY PER SCREEN COLUMN ===
      for(let col=0;col<CW;col++){
        const rc=rayCosT[col],rs=raySinT[col];
        const rdx=cosPA*rc-sinPA*rs;
        const rdy=sinPA*rc+cosPA*rs;

        let mapX=Math.floor(px);
        let mapY=Math.floor(py);

        const dDistX=(rdx===0)?1e30:Math.abs(1/rdx);
        const dDistY=(rdy===0)?1e30:Math.abs(1/rdy);

        let stepX,stepY,sDistX,sDistY;
        if(rdx<0){stepX=-1;sDistX=(px-mapX)*dDistX;}
        else{stepX=1;sDistX=(mapX+1-px)*dDistX;}
        if(rdy<0){stepY=-1;sDistY=(py-mapY)*dDistY;}
        else{stepY=1;sDistY=(mapY+1-py)*dDistY;}

        let side=0,hit=false,hitTile=0,hitDoorHalf=null,doorWallX=0;
        let eucDist=0;
        for(let i=0;i<64;i++){
          if(sDistX<sDistY){sDistX+=dDistX;mapX+=stepX;side=0;}
          else{sDistY+=dDistY;mapY+=stepY;side=1;}
          if(mapX<0||mapX>=MW||mapY<0||mapY>=MH)break;
          const tv=map[mapY][mapX];

          if(tv===T.DOOR){ // thin split door at the center of the tile
            const ds=doorStates[mapX+','+mapY];
            const doff=ds?ds.offset:0;
            let doorDist,hitPos;
            if(side===0){doorDist=(sDistX-dDistX)+(dDistX/2);hitPos=py+doorDist*rdy;if(Math.floor(hitPos)!==mapY)continue;}
            else{doorDist=(sDistY-dDistY)+(dDistY/2);hitPos=px+doorDist*rdx;if(Math.floor(hitPos)!==mapX)continue;}
            const frac=hitPos-Math.floor(hitPos);
            const cL=0.5-doff,cR=0.5+doff;
            if(frac<=cL){
              hit=true;hitTile=T.DOOR;hitDoorHalf='left';eucDist=doorDist;
              doorWallX=(cL>0)?(frac/cL)*0.5:0;break;
            }else if(frac>=cR){
              hit=true;hitTile=T.DOOR;hitDoorHalf='right';eucDist=doorDist;
              doorWallX=(1-cR>0)?0.5+((frac-cR)/(1-cR))*0.5:0.5;break;
            }
            continue; // gap in the middle — ray passes through
          }
          else if(tv===T.PIT||tv===T.FLOOR){continue;} // walkable, no wall face
          else if(tv>=1){hit=true;hitTile=tv;break;} // wall / stairs / illusion — anything else solid
        }
        if(!hit)continue;

        if(hitTile!==T.DOOR){
          if(side===0)eucDist=sDistX-dDistX;
          else eucDist=sDistY-dDistY;
        }
        if(eucDist<0.001)eucDist=0.001;

        // perpDist eliminates fisheye — cos(this column's offset angle)
        // is already sitting in `rc` from the ray table, so no 2nd trig call.
        const perpDist=eucDist*rc;
        const useDist=(perpDist<0.001)?0.001:perpDist;

        const lineH=Math.floor(CH/useDist);
        const drawStart=Math.max(0,Math.floor(CH/2-lineH/2));
        const drawEnd=Math.min(CH-1,Math.floor(CH/2+lineH/2));

        let wallX;
        if(hitTile===T.DOOR){
          wallX=doorWallX;
        } else {
          if(side===0)wallX=py+eucDist*rdy;
          else wallX=px+eucDist*rdx;
          wallX-=Math.floor(wallX);
        }

        const shade=clamp(flicker/(useDist*0.35),0.06,1.0);
        const sideShade=(side===1)?0.65:1.0;
        const fogW=clamp(1-useDist/FOG_DIST,0.04,1.0);
        const fShade=shade*sideShade*fogW;
        const isIllusion=(hitTile===T.ILLUSION);

        const curTex=texturesEnabled?(hitTile===T.DOOR?textures.door:hitTile===T.STAIRS_DOWN?textures.stairsDown:hitTile===T.STAIRS_UP?textures.stairsUp:textures.wall):null;
        if(curTex){
          const tW=curTex.width,tH=curTex.height,td=curTex.data;
          const tCol=clamp(Math.floor(wallX*(tW-1)),0,tW-1);
          const illumMul=isIllusion?1.12:1;
          const wallTop=CH/2-lineH/2;
          const texStep=(tH-1)/lineH;
          for(let y=drawStart;y<=drawEnd;y++){
            const tRowF=(y-wallTop)*texStep;
            let tRow=tRowF<0?0:(tRowF|0);
            if(tRow>tH-1)tRow=tH-1;
            const tI=(tRow*tW+tCol)*4;
            const bI=(y*CW+col)*4;
            buf[bI]=Math.min(255,Math.floor(td[tI]*fShade*illumMul));
            buf[bI+1]=Math.min(255,Math.floor(td[tI+1]*fShade*illumMul));
            buf[bI+2]=Math.min(255,Math.floor(td[tI+2]*fShade*illumMul));
          }
        } else {
          const c=Math.floor(90*fShade);
          for(let y=drawStart;y<=drawEnd;y++){
            const bI=(y*CW+col)*4;
            buf[bI]=Math.min(255,Math.floor((c+30)*(isIllusion?1.12:1)));
            buf[bI+1]=Math.min(255,Math.floor((c+15)*(isIllusion?1.12:1)));
            buf[bI+2]=Math.min(255,Math.floor(c*(isIllusion?1.12:1)));
          }
        }
      }

      ctx.putImageData(imgData,0,0);
    }

    return {
      resize,
      render,
      get width(){return CW;},
      get height(){return CH;},
      canvas,
    };
  }

  return {create,TILE};
});
