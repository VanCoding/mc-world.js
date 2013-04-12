var nbt = require("nbt.js");
var mca = require("mca.js");
var fs = require("fs");
var WeakMap = require("weakmap.js");

module.exports = World;

function World(dirpath){
    this.dirpath = dirpath;
    this.regions = {};
	this.regioncallbacks = {};
    this.players = new WeakMap();
	this.playercallbacks = {};
}

World.prototype.translate = function(x,z){
    if(x >= 0){
        var chunkX = x%32;
        var regionX = (x-chunkX)/32;
    }else{
        var chunkX = 32+(x%32);
        var regionX = (x-chunkX)/32;
    }
    
    if(z >= 0){
        var chunkZ = z%32;
        var regionZ = (z-chunkZ)/32;
    }else{
        var chunkZ = 32+(z%32);
        var regionZ = (z-chunkZ)/32;
    }
    
    return {
        chunk:{
            x:chunkX,
            z:chunkZ
        },
        region:{
            x:regionX,
            z:regionZ            
        }
    }
}

World.prototype.translateBlockCoordinates = function(x,y,z){
    if(x >= 0){
        var blockX = x%16;
    }else{
        var blockX = 16+(x%16);
    }
    if(z >= 0){
        var blockZ = z%16;
    }else{
        var blockZ = 16+(z%16);
    }
    
    var c = {
        chunk:{
            x:(x-blockX)/16,
            z:(z-blockZ)/16
        },
        block:{
            x:blockX,
            y:y,
            z:blockZ
        }
    };
    
    return c;  
}

World.prototype.getPlayer = function(name,cb){
	var self = this;
    var player = this.players.get(name);
    if(player){
		cb(null,player);
    }else{
		var cbs = this.playercallbacks[name];
		if(cbs){
			cbs.push(cb);
		}else{
			this.playercallbacks[name] = cbs = [cb];
			
			function callcallbacks(err,player){
				delete self.playercallbacks[name];
				for(var i = 0; i < cbs.length; i++){
					cbs[i](err,player);
				}
			}

			fs.readFile(this.dirpath+"/players/"+name+".dat",function(err,data){
				if(err){
					callcallbacks(err);
				}else{
					nbt.unpack(data,function(err,data){
						if(err){
							callcallbacks(err);
						}else{
							self.players.set(name,player = new Player(self,name,data));
							callcallbacks(null,player);
						}
					}); 
				}
			});
		}
    }
}

World.prototype.getBlock = function(x,y,z,cb){
    var self = this;
    var c = this.translateBlockCoordinates(x,y,z);
    self.getChunk(c.chunk.x,c.chunk.z,function(err,chunk){        
        if(err){
            cb(err);
        }else{
            cb(null,chunk.getBlock(c.block.x,c.block.y,c.block.z));            
        }
    });
}

World.prototype.getChunk = function(x,z,cb){
    var self = this;
    var c = this.translate(x,z);
    var region = self.getRegion(c.region.x,c.region.z);
	region.getChunk(c.chunk.x,c.chunk.z,function(err,chunk){
		if(err){
			cb(err);
		}else{
			cb(null,chunk);
		}
	});
   
}


World.prototype.getRegion = function(x,z){
	var region = this.regions[x+"/"+z];
	if(!region){
		this.regions[x+"/"+z] = region = new Region(this,x,z,new mca(this.dirpath+"/region/r."+x+"."+z+".mca"));
	}
	return region;
}

function Player(world,name,data){
    this.world = world;
	this.name = name;
	this.data = data;
}

function Region(world,x,z,mca){
    this.world = world;
    this.x = x;
    this.z = z;
	this.mca = mca;
	this.chunks = new WeakMap();
	this.chunkcallbacks = {};
}


Region.prototype.getChunk = function(x,z,cb){
    var self = this;
    var chunk = this.chunks.get(x+"/"+z);
    if(!chunk){	
		var cbs = this.chunkcallbacks[x+"/"+z];
		if(!cbs){
			this.chunkcallbacks[x+"/"+z] = cbs = [cb];
			function callcallbacks(err,chunk){
				delete self.chunkcallbacks[x+"/"+z];
				for(var i = 0; i < cbs.length; i++){
					cbs[i](err,chunk);
				}
			}
			
			this.mca.read(x,z,function(err,data){
				if(err){
					callcallbacks(err);
				}else{
					if(data){
						data = nbt.parse(data);
						chunk = new Chunk(self,data)
						callcallbacks(null,chunk);
					}else{
						callcallbacks(new Error("Chunk does not exist"));
					}				
				}        
			});
		}else{
			cbs.push(cb);
		}
    }else{
		cb(null,chunk);
	}
}

function Chunk(region,data){
    this.region = region;
	this.data = data;
    this.blocks = new WeakMap();
}

Chunk.prototype.getX = function(){
	return this.data.Level.xPos;
}
Chunk.prototype.getY = function(){
	return this.data.Level.zPos;
}

Chunk.prototype.save = function(cb){
    this.region.mca.write(this.getX(),this.getY(),nbt.build(this.data),cb);
}

Chunk.prototype.getBlock = function(x,y,z){
    var block = this.blocks[x+"/"+y+"/"+z];
	if(!block){
		this.blocks[x+"/"+y+"/"+z] = block = new Block(this,x,(y-(y%16))/16,z);
    }
    return block;
}

function Block(chunk,x,y,z){
	this.chunk = chunk;
    this.y = y;
	this.index = y*256+z*16+x;
	this.pos = this.index%2;
	this.halfindex = (this.index-this.pos)/2;
}
Block.prototype._getSection = function(){
	return this.chunk.data.Level.Sections[this.y];
}
Block.prototype._getFull = function(arr){
	return arr[this.index];
}
Block.prototype._setFull = function(arr,val){
	arr[this.index] = val;
}
Block.prototype._getHalf = function(arr){
	var val = arr[this.halfindex];
	return pos?val>>4:val|15;
}
Block.prototype._setHalf = function(arr,val){
	arr[this.halfindex] = (this.getFull(this.index)|(pos?240:15))+(pos?val:val<<4);
}
Block.prototype.getType = function(){
	var section = this._getSection();
	var type = this._getFull(section.Blocks);
	if(section.Add){
		type += this._getHalf(section.Add)<<8;
	}
	return type;
}
Block.prototype.getSkyLight = function(){
	var section = this._getSection();
	if(section.SkyLight){
		return this._getHalf(section.SkyLight);
	}
}
Block.prototype.getBlockLight = function(){
	var section = this._getSection();
	if(section.BlockLight){
		return this._getHalf(section.BlockLight);
	}
}
Block.prototype.getData = function (){
	var section = this._getSection();
	if(section.Data){
		return this._getHalf(section.Data);
	}
}
Block.prototype.setType = function(type){
	var section = this._getSection();
	this._setFull(section.Blocks,type%256)
	if(section.Add){
		this._setHalf(section.Add,(type|3840)>>8);
	}
}
Block.prototype.setSkyLight = function(light){
	var section = this._getSection();
	if(section.SkyLight){
		this._setHalf(section.SkyLight,light);
	}
}
Block.prototype.setBlockLight = function(light){
	var section = this._getSection();
	if(section.BlockLight){
		this._setHalf(section.BlockLight,light);
	}
}
Block.prototype.setData = function(data){
	var section = this._getSection();
	if(section.Data){
		this._setHalf(section.Data,data);
	}
}


