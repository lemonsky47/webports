

const scriptsInEvents = {

	async Utilsev_Event4_Act2(runtime, localVars)
	{
		// constants
		const a = 1103515245; 		// multiplier
		const c = 12345;			// constant (consider large prime numbers)
		const m = 2 ** 31;			// modulus (the random value is mod + divided by this large value)
		
		// generate random number
		runtime.globalVars.randomSeed = (a * runtime.globalVars.randomSeed + c) % m;
		
		// map random number to 0-1
		const randNum = runtime.globalVars.randomSeed / m;
		
		// return function value
		localVars.value = randNum;
	},

	async Gameev_Event21(runtime, localVars)
	{
		//----------------------------------------------------------------------------------
		
		// recursive function, be careful!
		function calculateZValuesRecursively (obj, parentZValue, recursiveDepth) 
		{	
			obj.instVars.zValue = parentZValue + obj.instVars.zChildOrderIndex / 10 ** recursiveDepth;
			
			// for all relevant children
			for (const child of obj.children())
			{	
				// check that child is part of zOrder
				if (!child.objectType.isInFamily(zOrderType)) continue
		
				// call a recursive fucntion which will continue for that child's children, etc.
				calculateZValuesRecursively(child, obj.instVars.zValue, recursiveDepth + 1);
			}
		}
		
		//----------------------------------------------------------------------------------
		
		// var which determines what the top level parent has for zValue
		let zIndex = 0;
		
		const zOrderType = runtime.objects.zOrder;
		
		// get instances, sorted by y order
		const sortedList = zOrderType.getPickedInstances().sort((a, b) => a.y - b.y);
		
		// for each instance
		for (const inst of sortedList)
		{
			// get parent, for testing
			const parent = inst.getParent(); // will be null if not existing
			
			// test that this object doesn't have a zOrder parent
			if (parent && parent.objectType.isInFamily(zOrderType)) continue;
			
			// set off the recursive function that goes through the hierarchy using this parent
			calculateZValuesRecursively(inst, zIndex, 0);
				
			// increment
			zIndex++;
		}
		
		//----------------------------------------------------------------------------------
		
		// once all is done, use the system 'sort Z order' which uses the zValue inst var
		//runtime.sortZOrder(sortedList, (a, b) => a.instVars.zValue - b.instVars.zValue);
		
		//----------------------------------------------------------------------------------
	}
};

globalThis.C3.JavaScriptInEvents = scriptsInEvents;
