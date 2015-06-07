///////////////////////////////////////////////////////////////////////////////
// Copyright (c) ENikS.  All rights reserved.
//
// Licensed under the Apache License, Version 2.0  ( the  "License" );  you may 
// not use this file except in compliance with the License.  You may  obtain  a 
// copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required  by  applicable  law  or  agreed  to  in  writing,  software 
// distributed under the License is distributed on an "AS  IS"  BASIS,  WITHOUT
// WARRANTIES OR CONDITIONS  OF  ANY  KIND, either express or implied.  See the 
// License for the specific  language  governing  permissions  and  limitations 
// under the License.
//
// This code is based on  original  work  of  Jean-loup Gailly  and  Mark Adler

//
//  Copyright (C) 1995-2003 Jean-loup Gailly and Mark Adler
//
//  This software is provided 'as-is', without any express or implied
//  warranty.  In no event will the authors be held liable for any damages
//  arising from the use of this software.
//
//  Permission is granted to anyone to use this software for any purpose,
//  including commercial applications, and to alter it and redistribute it
//  freely, subject to the following restrictions:
//
//  1. The origin of this software must not be misrepresented; you must not
//     claim that you wrote the original software. If you use this software
//     in a product, an acknowledgment in the product documentation would be
//     appreciated but is not required.
//  2. Altered source versions must be plainly marked as such, and must not be
//     misrepresented as being the original software.
//  3. This notice may not be removed or altered from any source distribution.
//
//

// This class can be used to read bits from an byte array quickly.
// Normally we get bits from 'bitBuffer' field and bitsInBuffer stores
// the number of bits available in 'BitBuffer'.
// When we used up the bits in bitBuffer, we will try to get byte from
// the byte array and copy the byte to appropiate position in bitBuffer.
//
// The byte array is not reused. We will go from 'start' to 'end'. 
// When we reach the end, most read operations will return -1, 
// which means we are running out of input.

export class InputBuffer {

    private _bitBuffer: number = 0;      // store the bits here, we can quickly shift in this buffer
    private _bitsInBuffer: number = 0;    // number of bits available in bitBuffer
    _iterator: Iterator<number>;

    public constructor(iterator: Iterator<number>) {
        this._iterator = iterator;
    }

    // Total bits available in the input buffer
    public get AvailableBits() {
        return this._bitsInBuffer;
    }

        
    // This function will load up to 16 bits into bitBuffer.
    public TryGetBits(count = 15): number {
        var result: IteratorResult<number>;
        if ((this._bitsInBuffer < count) && !(result = this._iterator.next()).done) {
            this._bitBuffer |= result.value << this._bitsInBuffer;
            this._bitsInBuffer += 8;
            if ((this._bitsInBuffer < count) && !(result = this._iterator.next()).done) {
                this._bitBuffer |= result.value << this._bitsInBuffer;
                this._bitsInBuffer += 8;
            }
        }
        return this._bitBuffer;
    }

    public GetBits(count: number): number {
        var result: IteratorResult<number>;
        if ((this._bitsInBuffer < count) && !(result = this._iterator.next()).done) {
            this._bitBuffer |= result.value << this._bitsInBuffer;
            this._bitsInBuffer += 8;
            if ((this._bitsInBuffer < count) && !(result = this._iterator.next()).done) {
                this._bitBuffer |= result.value << this._bitsInBuffer;
                this._bitsInBuffer += 8;
            }
        }

        var bits: number = (this._bitBuffer & ((1 << count) - 1));
        this._bitBuffer >>= count;
        this._bitsInBuffer -= count;
        return bits;
    }

    // Skip n bits in the buffer
    public SkipBits(n: number) {
        this._bitBuffer >>= n;
        this._bitsInBuffer -= n;
    }

    // Skips to the next byte boundary.
    public SkipToByteBoundary() {
        this._bitBuffer >>= (this._bitsInBuffer % 8);
        this._bitsInBuffer = this._bitsInBuffer - (this._bitsInBuffer % 8);
    }
}
