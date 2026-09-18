/*!
 * dungeon-generator.js — standalone rooms + maze + doors dungeon generator
 * Extracted from "Depths of Dreadmoor" (github.com — see project this file
 * shipped with). Zero dependencies, no build step required.
 *
 * ── What it does ───────────────────────────────────────────────────────
 * generate(width, height, options) builds one dungeon floor: a mix of
 * hand-shaped rooms (connected by their own doors) joined together by a
 * carved maze of 1-wide corridors, then layers in a handful of secondary
 * features — extra doors and illusionary walls punched into thick wall
 * segments, the occasional floor pit, and a connectivity pass that
 * guarantees every walkable tile is actually reachable from every other
 * one (no isolated pockets left behind by the room/maze carving).
 *
 * ── Usage (plain <script>, no bundler) ────────────────────────────────
 *   <script src="dungeon-generator.js"></script>
 *   <script>
 *     const dungeon = DungeonGenerator.generate(31, 31);
 *     dungeon.map;    // dungeon.map[y][x] — a TILE.* integer, see below
 *     dungeon.rooms;  // [{x,y,w,h,cx,cy}, ...] — the placed room rects
 *   </script>
 *
 * ── Usage (Node / bundlers / ES module via require) ───────────────────
 *   const DungeonGenerator = require('./dungeon-generator.js');
 *   const dungeon = DungeonGenerator.generate(31, 31, {roomDensity: 1.2});
 *
 * ── Tile values (DungeonGenerator.TILE) ────────────────────────────────
 *   FLOOR (0)        open, walkable
 *   WALL (1)         solid — blocks movement and sight
 *   STAIRS_DOWN (2)  reserved value; this generator never places it —
 *                    pick a spot yourself (pickDeadEndNear() below is
 *                    built for exactly that) and set map[y][x] = 2
 *   STAIRS_UP (3)    reserved, same story as STAIRS_DOWN
 *   DOOR (4)         walkable; render/animate as an openable door
 *   ILLUSION (5)     looks like WALL until the caller decides it's been
 *                    "discovered", after which it behaves like FLOOR
 *   PIT (6)          walkable but hazardous — meaning is up to the caller
 *
 * Only whole floors are in scope here — no items, monsters, lighting, or
 * a player object. Combine the map this returns with your own renderer
 * (a DDA raycaster, a 2D tile renderer, etc.) and your own game state.
 *
 * ── Determinism ─────────────────────────────────────────────────────────
 * Generation calls Math.random() directly throughout (matching the
 * original game's behavior) — there's no seeded/injectable RNG, so two
 * calls with the same arguments will (by design) produce different
 * layouts. Wrap Math.random yourself before calling if you need to
 * capture/replay a specific seed.
 */
const DungeonGenerator = (function(factory){
  return factory();
})(function(){
  'use strict';

  const TILE={FLOOR:0,WALL:1,STAIRS_DOWN:2,STAIRS_UP:3,DOOR:4,ILLUSION:5,PIT:6};

  function isWalkable(v){return v===TILE.FLOOR||v===TILE.STAIRS_DOWN||v===TILE.STAIRS_UP||v===TILE.DOOR||v===TILE.ILLUSION||v===TILE.PIT;}
  // A dead-end/spawn search only cares about tiles a character could have
  // walked in from — pits are deliberately excluded (you don't "arrive"
  // standing in one).
  function isOpenNeighbour(v){return v===TILE.FLOOR||v===TILE.STAIRS_DOWN||v===TILE.STAIRS_UP||v===TILE.DOOR||v===TILE.ILLUSION;}

  // ---- Room shapes: RW=room wall, D=door gap, F=floor. Every template's
  // doors sit at the midpoint of each of its four sides. ----
  const _F=0,_W=1,_C=2,_RW=3,_D=4,_IL=5,_PIT=8;
  const ROOM_TEMPLATES={
    '5x5':[[[_RW,_RW,_D,_RW,_RW],[_RW,_F,_F,_F,_RW],[_D,_F,_F,_F,_D],[_RW,_F,_F,_F,_RW],[_RW,_RW,_D,_RW,_RW]]],
    '5x7':[[[_RW,_RW,_D,_RW,_RW],[_RW,_F,_F,_F,_RW],[_D,_F,_F,_F,_D],[_RW,_F,_F,_F,_RW],[_D,_F,_F,_F,_D],[_RW,_F,_F,_F,_RW],[_RW,_RW,_D,_RW,_RW]]],
    '7x5':[[[_RW,_RW,_RW,_D,_RW,_RW,_RW],[_RW,_F,_F,_F,_F,_F,_RW],[_RW,_F,_F,_F,_F,_F,_RW],[_RW,_F,_F,_F,_F,_F,_RW],[_RW,_RW,_RW,_D,_RW,_RW,_RW]]],
    '7x7':[[[_RW,_RW,_RW,_D,_RW,_RW,_RW],[_RW,_F,_F,_F,_F,_F,_RW],[_RW,_F,_F,_F,_F,_F,_RW],[_D,_F,_F,_F,_F,_F,_D],[_RW,_F,_F,_F,_F,_F,_RW],[_RW,_F,_F,_F,_F,_F,_RW],[_RW,_RW,_RW,_D,_RW,_RW,_RW]]]
  };
  const ROOM_SIZES=[{w:5,h:5},{w:5,h:7},{w:7,h:5},{w:7,h:7}];

  /**
   * Generate one dungeon floor.
   * @param {number} w - width in tiles (odd numbers give the cleanest maze; any size works)
   * @param {number} h - height in tiles
   * @param {object} [options]
   * @param {number} [options.roomDensity=0.1] - scales how many rooms are
   *   attempted: maxRooms ≈ floor(w*h*0.08*roomDensity). 0.1 (the
   *   default, and what the original game always used) gives a light
   *   scattering of rooms in a mostly-maze floor; try ~1 for a much more
   *   room-heavy layout.
   * @returns {{map:number[][], rooms:{x:number,y:number,w:number,h:number,cx:number,cy:number}[]}}
   */
  function generate(w,h,options){
    options=options||{};
    const roomDensity=options.roomDensity!=null?options.roomDensity:0.1;
    const pick=a=>a[Math.floor(Math.random()*a.length)];

    const map=[];for(let y=0;y<h;y++){map[y]=[];for(let x=0;x<w;x++)map[y][x]=_W;}
    const rooms=[];
    function randEven(mn,mx){if(mn%2!==0)mn++;if(mx%2!==0)mx--;if(mn>mx)return null;return mn+2*Math.floor(Math.random()*((mx-mn)/2+1));}

    // --- Place rooms ---
    const maxAttempts=Math.floor(w*h*0.6),maxRooms=Math.floor(w*h*0.08*roomDensity);
    let att=0;
    while(rooms.length<maxRooms&&att<maxAttempts){
      att++;const sz=pick(ROOM_SIZES);const rw=sz.w,rh=sz.h;
      const xM=w-rw,yM=h-rh;if(xM<0||yM<0)continue;
      const rx=randEven(0,xM),ry=randEven(0,yM);if(rx===null||ry===null)continue;
      const tpls=ROOM_TEMPLATES[rw+'x'+rh];if(!tpls||!tpls.length)continue;
      const tpl=tpls[Math.floor(Math.random()*tpls.length)];
      let ok=true;
      for(let dy=0;dy<rh&&ok;dy++)for(let dx=0;dx<rw&&ok;dx++){
        const ex=map[ry+dy][rx+dx],tv=tpl[dy][dx];
        if(ex===_W)continue;if(ex===tv)continue;if(ex===_RW&&tv===_RW)continue;ok=false;
      }
      if(!ok)continue;
      for(let dy=0;dy<rh;dy++)for(let dx=0;dx<rw;dx++){
        const v=tpl[dy][dx];map[ry+dy][rx+dx]=(v===_RW)?_RW:(v===_D)?_D:_F;
      }
      rooms.push({x:rx,y:ry,w:rw,h:rh,cx:rx+Math.floor(rw/2),cy:ry+Math.floor(rh/2)});
      // 50% chance to remove each door, but keep at least one
      const doorTiles=[];
      for(let dy=0;dy<rh;dy++)for(let dx=0;dx<rw;dx++){
        if(map[ry+dy][rx+dx]===_D)doorTiles.push({x:rx+dx,y:ry+dy});
      }
      if(doorTiles.length>1){
        const toRemove=[];
        for(const dt of doorTiles){if(Math.random()<0.5)toRemove.push(dt);}
        if(toRemove.length>=doorTiles.length)toRemove.pop();
        for(const dt of toRemove)map[dt.y][dt.x]=_RW;
      }
    }

    // --- Maze (recursive backtracker, step-2) ---
    function carveM(sx,sy){
      const stk=[[sx,sy]];map[sy][sx]=_C;
      while(stk.length){
        const[cx,cy]=stk[stk.length-1];
        const dirs=[[0,-2],[2,0],[0,2],[-2,0]].sort(()=>Math.random()-.5);
        let carved=false;
        for(const[dx,dy]of dirs){
          const nx=cx+dx,ny=cy+dy;
          if(nx<=0||ny<=0||nx>=w-1||ny>=h-1||map[ny][nx]!==_W)continue;
          map[cy+dy/2][cx+dx/2]=_C;map[ny][nx]=_C;stk.push([nx,ny]);carved=true;break;
        }
        if(!carved)stk.pop();
      }
    }
    for(let y=1;y<h-1;y+=2)for(let x=1;x<w-1;x+=2)if(map[y][x]===_W)carveM(x,y);

    // --- Sanitize doors against solid walls ---
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      if(map[y][x]!==_D)continue;
      for(const[nx,ny]of[[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
        if(nx>=0&&nx<w&&ny>=0&&ny<h&&map[ny][nx]===_W){map[y][x]=_RW;break;}
      }
    }

    // --- Wall features (doors, illusionary walls) ---
    const cands=[];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const v=map[y][x];if(v!==_W&&v!==_RW)continue;
      let fc=0;for(const[nx,ny]of[[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
        if(nx>=0&&nx<w&&ny>=0&&ny<h){const nv=map[ny][nx];if(nv===_F||nv===_C)fc++;}
      }
      if(fc>=3)cands.push([x,y]);
    }
    function adjDoor(x,y){for(const[nx,ny]of[[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(nx>=0&&nx<w&&ny>=0&&ny<h&&map[ny][nx]===_D)return true;}return false;}
    for(const[cx,cy]of cands){
      const fn=[];for(const[nx,ny]of[[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]){
        if(nx>=0&&nx<w&&ny>=0&&ny<h){const nv=map[ny][nx];if(nv===_F||nv===_C)fn.push([nx,ny]);}
      }
      if(!fn.length)continue;
      const roll=Math.floor(Math.random()*6)+1;
      if(roll===1||roll===3){fn.sort(()=>Math.random()-.5);for(const[nx,ny]of fn){if(!adjDoor(nx,ny)){map[ny][nx]=_D;break;}}}
      else if(roll===2){fn.sort(()=>Math.random()-.5);for(const[nx,ny]of fn){if(!adjDoor(nx,ny)){map[ny][nx]=_IL;break;}}}
    }

    // --- Connect rooms to maze ---
    const cors=[];for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(map[y][x]===_C)cors.push([x,y]);
    function manh(a,b){return Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);}
    function tunnel(a,b){
      if(Math.random()<.5){
        for(let x=Math.min(a[0],b[0]);x<=Math.max(a[0],b[0]);x++)if(map[a[1]][x]===_W)map[a[1]][x]=_C;
        for(let y=Math.min(a[1],b[1]);y<=Math.max(a[1],b[1]);y++)if(map[y][b[0]]===_W)map[y][b[0]]=_C;
      }else{
        for(let y=Math.min(a[1],b[1]);y<=Math.max(a[1],b[1]);y++)if(map[y][a[0]]===_W)map[y][a[0]]=_C;
        for(let x=Math.min(a[0],b[0]);x<=Math.max(a[0],b[0]);x++)if(map[b[1]][x]===_W)map[b[1]][x]=_C;
      }
    }
    if(cors.length)for(const rm of rooms){
      let adj=false;
      outer:for(let yy=rm.y;yy<rm.y+rm.h;yy++)for(let xx=rm.x;xx<rm.x+rm.w;xx++){
        for(const[nx,ny]of[[xx-1,yy],[xx+1,yy],[xx,yy-1],[xx,yy+1]])
          if(nx>=0&&nx<w&&ny>=0&&ny<h&&map[ny][nx]===_C){adj=true;break outer;}
      }
      if(adj)continue;
      let bd=Infinity,bc=null,bco=null;
      for(let yy=rm.y;yy<rm.y+rm.h;yy++)for(let xx=rm.x;xx<rm.x+rm.w;xx++){
        if(map[yy][xx]!==_D)continue;
        for(const[nx,ny]of[[xx-1,yy],[xx+1,yy],[xx,yy-1],[xx,yy+1]]){
          if(nx<rm.x||nx>=rm.x+rm.w||ny<rm.y||ny>=rm.y+rm.h){
            if(nx>=0&&nx<w&&ny>=0&&ny<h)for(const c of cors){const d=manh([nx,ny],c);if(d<bd){bd=d;bc=[nx,ny];bco=c;}}
          }
        }
      }
      if(!bc){
        const perim=[];
        for(let xx=rm.x;xx<rm.x+rm.w;xx++){if(rm.y-1>=0)perim.push([xx,rm.y-1]);if(rm.y+rm.h<h)perim.push([xx,rm.y+rm.h]);}
        for(let yy=rm.y;yy<rm.y+rm.h;yy++){if(rm.x-1>=0)perim.push([rm.x-1,yy]);if(rm.x+rm.w<w)perim.push([rm.x+rm.w,yy]);}
        for(const p of perim)for(const c of cors){const d=manh(p,c);if(d<bd){bd=d;bc=p;bco=c;}}
      }
      if(bc&&bco)tunnel(bc,bco);
    }

    // --- Place pits (2% of corridor tiles) ---
    const pitCands=[];for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(map[y][x]===_C)pitCands.push([x,y]);
    pitCands.sort(()=>Math.random()-.5);
    function adjPit(x,y){for(const[nx,ny]of[[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(nx>=0&&nx<w&&ny>=0&&ny<h&&map[ny][nx]===_PIT)return true;}return false;}
    for(const[px,py]of pitCands){if(map[py][px]!==_C)continue;if(Math.random()<0.02&&!adjPit(px,py))map[py][px]=_PIT;}

    // --- Cleanup: perimeter, room walls → walls, corridors → floors ---
    for(let x=0;x<w;x++){map[0][x]=_W;map[h-1][x]=_W;}
    for(let y=0;y<h;y++){map[y][0]=_W;map[y][w-1]=_W;}
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      if(map[y][x]===_RW)map[y][x]=_W;else if(map[y][x]===_C)map[y][x]=_F;
    }

    // --- Convert to public tile values ---
    const result=[];
    for(let y=0;y<h;y++){result[y]=[];for(let x=0;x<w;x++){
      const v=map[y][x];
      result[y][x]=(v===_D)?TILE.DOOR:(v===_IL)?TILE.ILLUSION:(v===_PIT)?TILE.PIT:(v===_W)?TILE.WALL:TILE.FLOOR;
    }}

    // --- Connectivity check: ensure all walkable tiles are reachable ---
    function floodFill(sx,sy,visited){
      const stk=[[sx,sy]];visited[sy][sx]=true;
      while(stk.length){
        const[cx,cy]=stk.pop();
        for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){
          const nx=cx+dx,ny=cy+dy;
          if(nx>=0&&nx<w&&ny>=0&&ny<h&&!visited[ny][nx]&&isWalkable(result[ny][nx])){
            visited[ny][nx]=true;stk.push([nx,ny]);
          }
        }
      }
    }
    let allConnected=false;
    for(let pass=0;pass<50&&!allConnected;pass++){
      const visited=[];for(let y=0;y<h;y++){visited[y]=[];for(let x=0;x<w;x++)visited[y][x]=false;}
      let startX=-1,startY=-1;
      for(let y=1;y<h-1&&startX<0;y++)for(let x=1;x<w-1&&startX<0;x++){if(isWalkable(result[y][x])){startX=x;startY=y;}}
      if(startX<0)break;
      floodFill(startX,startY,visited);
      let ux=-1,uy=-1;
      for(let y=1;y<h-1&&ux<0;y++)for(let x=1;x<w-1&&ux<0;x++){if(isWalkable(result[y][x])&&!visited[y][x]){ux=x;uy=y;}}
      if(ux<0){allConnected=true;break;}
      let bestWall=null,bestDist=Infinity;
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        if(result[y][x]!==TILE.WALL)continue;
        let touchReached=false,touchUnreached=false;
        for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){
          const nx=x+dx,ny=y+dy;
          if(nx>=0&&nx<w&&ny>=0&&ny<h&&isWalkable(result[ny][nx])){
            if(visited[ny][nx])touchReached=true;
            else touchUnreached=true;
          }
        }
        if(touchReached&&touchUnreached){
          const d=Math.abs(x-ux)+Math.abs(y-uy);
          if(d<bestDist){bestDist=d;bestWall={x,y};}
        }
      }
      if(bestWall){
        const bx=bestWall.x,by=bestWall.y;
        const adjDoor4=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>{
          const nx=bx+dx,ny=by+dy;
          return nx>=0&&nx<w&&ny>=0&&ny<h&&result[ny][nx]===TILE.DOOR;
        });
        result[by][bx]=(Math.random()<0.5&&!adjDoor4)?TILE.ILLUSION:TILE.DOOR;
      } else {
        let closest=null,cd=Infinity;
        for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
          if(result[y][x]!==TILE.WALL)continue;
          let adjReached=false;
          for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){
            const nx=x+dx,ny=y+dy;
            if(nx>=0&&nx<w&&ny>=0&&ny<h&&isWalkable(result[ny][nx])&&visited[ny][nx])adjReached=true;
          }
          if(adjReached){const d=Math.abs(x-ux)+Math.abs(y-uy);if(d<cd){cd=d;closest={x,y};}}
        }
        if(closest)result[closest.y][closest.x]=Math.random()<0.5?TILE.DOOR:TILE.ILLUSION;
        else break;
      }
    }

    return {map:result,rooms};
  }

  /** All floor tiles with exactly one walkable neighbour. */
  function findDeadEnds(map,w,h){
    const ends=[];
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      if(map[y][x]!==TILE.FLOOR)continue;
      let open=0;
      for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){
        if(isOpenNeighbour(map[y+dy][x+dx]))open++;
      }
      if(open===1)ends.push({x,y});
    }
    return ends;
  }

  /** Closest walkable FLOOR tile to (tx,ty), optionally excluding one point — a fallback for when no dead end is available. */
  function findNearestFloor(map,w,h,tx,ty,exclude){
    let bd=Infinity,bp=null;
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      if(map[y][x]!==TILE.FLOOR)continue;
      if(exclude&&x===exclude.x&&y===exclude.y)continue;
      const d=Math.abs(x-tx)+Math.abs(y-ty);
      if(d<bd){bd=d;bp={x,y};}
    }
    return bp;
  }

  /**
   * Convenience placement helper for stairs/entrances/exits: the dead end
   * closest to (prefX,prefY) (excluding one point, e.g. a stairway you
   * already placed elsewhere), falling back to the nearest plain floor
   * tile if the floor happens to have no dead ends at all.
   */
  function pickDeadEndNear(map,w,h,prefX,prefY,exclude){
    const ends=findDeadEnds(map,w,h).filter(e=>!(exclude&&e.x===exclude.x&&e.y===exclude.y));
    ends.sort((a,b)=>(Math.abs(a.x-prefX)+Math.abs(a.y-prefY))-(Math.abs(b.x-prefX)+Math.abs(b.y-prefY)));
    return ends[0]||findNearestFloor(map,w,h,prefX,prefY,exclude);
  }

  /**
   * Direction (0=N, 1=E, 2=S, 3=W) a character standing at a dead end
   * (x,y) should face to look down its one open side.
   */
  function deadEndFacing(map,w,h,x,y){
    const DIRS=[[0,0,-1],[1,1,0],[2,0,1],[3,-1,0]];
    for(const[di,dx,dy]of DIRS){
      const nx=x+dx,ny=y+dy;
      if(nx>=0&&nx<w&&ny>=0&&ny<h&&isOpenNeighbour(map[ny][nx]))return di;
    }
    return 2;
  }

  return {generate,findDeadEnds,findNearestFloor,pickDeadEndNear,deadEndFacing,TILE};
});

// --- Added for Underkeep ---------------------------------------------------
// The original UMD wrapper cannot load in this project: package.json sets
// "type": "module", so this file is an ES module in Node, esbuild and Vite
// alike, where top-level `this` is undefined and `module` is either missing or
// a read-only namespace object. Both of its branches therefore threw before
// the factory ever ran. The wrapper is reduced to calling the factory, and the
// exports below replace it. The factory itself is untouched, and its output is
// byte-identical for the same sequence of Math.random draws.
// See docs/DECISIONS.md, 2026-09-18.
export default DungeonGenerator;
export const { generate, findDeadEnds, findNearestFloor, pickDeadEndNear, deadEndFacing, TILE } =
  DungeonGenerator;
