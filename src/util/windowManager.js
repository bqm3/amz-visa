const { execSync } = require('child_process');

class WindowManager {
    constructor() {
        this.windowPositions = [];
        this.currentIndex = 0;
        this.initializePositions();
    }

    initializePositions() {
       
        let screenWidth = 1920;  
        let screenHeight = 1080;
        
       
        try {
            if (process.platform === 'win32') {
    
                const output = execSync('wmic path Win32_VideoController get CurrentHorizontalResolution,CurrentVerticalResolution /format:value', { encoding: 'utf8' });
                const lines = output.split('\n');
                
                let detectedWidth = null;
                let detectedHeight = null;
                
                for (const line of lines) {
                    const widthMatch = line.match(/CurrentHorizontalResolution=(\d+)/);
                    const heightMatch = line.match(/CurrentVerticalResolution=(\d+)/);
                    
                    if (widthMatch && parseInt(widthMatch[1]) > 0) {
                        detectedWidth = parseInt(widthMatch[1]);
                    }
                    if (heightMatch && parseInt(heightMatch[1]) > 0) {
                        detectedHeight = parseInt(heightMatch[1]);
                    }
                }
                
                if (detectedWidth && detectedHeight) {
                    screenWidth = detectedWidth;
                    screenHeight = detectedHeight;
                    console.log(`📺 Detected screen: ${screenWidth}x${screenHeight}`);
                } else {
                    console.log('❌ Could not detect screen resolution, using fallback');
                }
                
            } else if (process.platform === 'darwin') {
            
                const output = execSync("system_profiler SPDisplaysDataType | grep Resolution", { encoding: 'utf8' });
                const match = output.match(/(\d+) x (\d+)/);
                if (match) {
                    screenWidth = parseInt(match[1]);
                    screenHeight = parseInt(match[2]);
                    console.log(`📺 Detected Mac screen: ${screenWidth}x${screenHeight}`);
                }
            } else if (process.platform === 'linux') {
          
                const output = execSync("xrandr | grep '*' | head -1", { encoding: 'utf8' });
                const match = output.match(/(\d+)x(\d+)/);
                if (match) {
                    screenWidth = parseInt(match[1]);
                    screenHeight = parseInt(match[2]);
                    console.log(`📺 Detected Linux screen: ${screenWidth}x${screenHeight}`);
                }
            }
        } catch (error) {
            console.log(`⚠️ Screen detection failed: ${error.message}, using fallback ${screenWidth}x${screenHeight}`);
        }

     
        const cols = 4;  // 4 cột
        const rows = 2;  // 2 hàng
        
        // ✅ CALCULATE OPTIMAL WINDOW SIZE
        const windowWidth = Math.floor(screenWidth / cols);
        const windowHeight = Math.floor(screenHeight / rows);
        
       
        const taskbarHeight = 40; // Windows taskbar height
        const titleBarHeight = 30; // Window title bar
        const adjustedHeight = Math.floor((screenHeight - taskbarHeight) / rows);
        
        
        this.windowPositions = [];
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                this.windowPositions.push({
                    x: col * windowWidth,
                    y: row * adjustedHeight,
                    width: windowWidth - 10, 
                    height: adjustedHeight - 10
                });
            }
        }
        
        console.log(`🏁 Window Manager initialized:`);
        console.log(`   📺 Screen: ${screenWidth}x${screenHeight}`);
        console.log(`   🔢 Grid: ${rows} rows x ${cols} columns (${this.windowPositions.length} windows)`);
        console.log(`   📐 Window size: ${windowWidth-10}x${adjustedHeight-10}`);
        
   
        const monitorType = this.getMonitorType(screenWidth, screenHeight);
        console.log(`   🖥️ Monitor type: ${monitorType}`);
    }

 
    getMonitorType(width, height) {
        const aspectRatio = (width / height).toFixed(2);
        
        if (width >= 3840) return `4K/UHD (${width}x${height})`;
        if (width >= 2560) return `QHD/1440p (${width}x${height})`;
        if (width >= 1920) return `Full HD (${width}x${height})`;
        if (width >= 1600) return `HD+ (${width}x${height})`;
        if (width >= 1366) return `HD (${width}x${height})`;
        
        return `Custom (${width}x${height}, ratio: ${aspectRatio})`;
    }

    getNextPosition() {
        if (this.windowPositions.length === 0) {
            console.log('🪟 Fallback position: (0, 0)');
            return { x: 0, y: 0, width: 480, height: 540 };
        }
        
        const position = this.windowPositions[this.currentIndex % this.windowPositions.length];
        this.currentIndex++;
        
        console.log(`🪟 Window ${this.currentIndex}: Position (${position.x}, ${position.y}) Size ${position.width}x${position.height}`);
        return position;
    }

  
    getTotalPositions() {
        return this.windowPositions.length;
    }

  
    getCurrentUsage() {
        return {
            used: this.currentIndex % this.windowPositions.length,
            total: this.windowPositions.length,
            cycleCount: Math.floor(this.currentIndex / this.windowPositions.length)
        };
    }

    reset() {
        this.currentIndex = 0;
        console.log('🔄 Window positions reset - Ready for new 2x4 grid cycle');
    }

   
    showAllPositions() {
    
        this.windowPositions.forEach((pos, index) => {
            const row = Math.floor(index / 4) + 1;
            const col = (index % 4) + 1;
            console.log(`   Position ${index + 1} (Row ${row}, Col ${col}): (${pos.x}, ${pos.y}) ${pos.width}x${pos.height}`);
        });
    }
}

// Create and export global instance
const windowManager = new WindowManager();

module.exports = windowManager;