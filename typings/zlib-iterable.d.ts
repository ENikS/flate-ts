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


declare module ZLib {
    /**
    * Inflates deflated archave stored in Iterable<T> 
    * @param source An Array, Typed array, String or other Iterable object.
    * @example
    *  var iterable: Iterable<T> = inflate(arr); 
    */
    export function asInflatable<T>(deflated?: Iterable<T>): Iterable<T>;
    
    /**
    * Inflates deflated archave packaged as zlib stream and stored in Iterable<T> object.
    * @param source An Array, Typed array, String or other Iterable object.
    * @example
    *  var iterable: Iterable<T> = zlibInflate(arr); 
    */
    //export function asZLibInflatable<T>(source?: Iterable<T>): Iterable<T>;
}


declare module "zlib-iterable" {
    export = ZLib;
}



