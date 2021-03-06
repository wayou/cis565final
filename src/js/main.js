var spawnObjs = 2;
var fracturePattern;
var wireframe = false;
var debugfracturemesh = false;

function updateGeoStats(scene) {
    var faces = 0,
        verts = 0,
        meshes = scene.sceneObjects.length;
    
    for (var i = 0; i < meshes; i++) {
        faces += scene.sceneObjects[i].obj.faces.length;
        verts += scene.sceneObjects[i].obj.points.length;
    }
    
    document.getElementById("face_count").innerHTML = faces;
    document.getElementById("vertex_count").innerHTML = verts;
    document.getElementById("mesh_count").innerHTML = meshes;
    
}

// Loads in the base mesh to be fractured.
// Currently limited to convex hulls only.
// NOTE: Asteroid.dae is NOT purely convex.
function generateObjects() {
    var result = [];
    
    var astModel = CubicVR.loadCollada("models/wall.dae", "models/");
    // Add a ast to mesh, size 1.0
    var astObj = astModel.getSceneObject("wall");
    
    var astMesh = astObj.getMesh();
    
    var astCollision = new CubicVR.CollisionMap({
        type: CubicVR.enums.collision.shape.CONVEX_HULL,
        mesh: astMesh,
    });
    result.push({mesh:astMesh,collision:astCollision});
    
    
    return result;
}

// Binds the objects to the renderer and physics engine
function spawnObjects(scene,physics,objlist) {
    var nobjs = objlist.length;

    var b = parseInt(window.location.search.substr(1),10);
    if (b && !(b!=b)) spawnObjs = b;

    for (var i = 0; i < spawnObjs; i++) {
        var src = objlist[i%nobjs];

        var sceneObj = new CubicVR.SceneObject({
            name: "ast_obj" + i,
            mesh:src.mesh,
            position:[(Math.random()-0.5)*2.0*10,0,(Math.random()-0.5)*2.0*10],
            rotation:[0,0,0],
        });
        var rigidObj = new CubicVR.RigidBody(sceneObj, {
            name: "ast_rigid" + i,
            type: "dynamic",
            mass: 1,
            collision: src.collision
        });
        //console.log(sceneObj);
        //console.log(rigidObj);

        scene.bind(sceneObj);
        physics.bind(rigidObj);
    }
}

function zpad(number) {
    if (number <= 999) { number = ("00"+number).slice(-3); }
    return number;
}

// Loads in a fracture pattern as an array of meshes.  Currently at models/icoshatter.dae.
function loadFracturePattern() {
    var result = [];

    var astModel = CubicVR.loadCollada("models/cubeshatter.dae", "models/");
    // TODO: make this more flexible with naming, or replace with our own voronoi decomp.
    for (var i = 0; i < astModel.sceneObjects.length; i++) {
        var astMesh = astModel.getSceneObject("Cube_cell_" + zpad(i)).getMesh();
        var astPos = astModel.getSceneObject("Cube_cell_" + zpad(i)).position;
        astMesh.buildEdges();
        
        // Currently also saves in the collision just for debugging.
        var astCollision = new CubicVR.CollisionMap({
            type: CubicVR.enums.collision.shape.CONVEX_HULL,
            mesh: astMesh,
        });
        result.push({mesh:astMesh, position:astPos, collision:astCollision});
    }

    return result;
}

function flipEdge(e) {
    var edge;
    edge = [e[1], e[0]];
    edge.state = e.state;
    return edge;
}

function cellToPlanes(cell, center, position) {
    var cellPlanes = [];
    for (var i = 0; i < cell.faces.length; i++) {
        var p1 = add3(cell.points[cell.faces[i].points[0]], position);
        var p2 = add3(cell.points[cell.faces[i].points[1]], position);
        var p3 = add3(cell.points[cell.faces[i].points[2]], position);
        
        // flips the normal if it's facing inward
        var norm = cross3(sub3(p2, p1), sub3(p3, p1));
        if (dot3(norm, sub3(center, p1)) < 0) {
            norm = mult3c(norm, -1);
        }
        
        norm = normalize3(norm);
        if (!containsNormal(cellPlanes, norm)) {
            cellPlanes.push({normal:norm, d:-dot3(norm, p1), p:p1});
        }
    }
    return cellPlanes;
}

// extremely naive sequential implementation of intersection algorithm.
function intersect(mesh, cell, cellPos) {
    // compute 
    var points = mesh.points.slice();
    var faces = [];
    var edges = [];
    
    var center = [0,0,0];   // center of volume, average of all vertices.  Used to find the correct clipping face normal.
    for (var i = 0; i < cell.points.length; i++) {
        center = [center[0] + cell.points[i][0], center[1] + cell.points[i][1], center[2] + cell.points[i][2]];
    }
    center = [center[0]/points.length, center[1]/points.length, center[2]/points.length];
    center = add3(center, cellPos);
    
    // Generates the array of points.
    /* points is an float[3] with properties:
     *  bool culled
     * points stores the coordinates of the vertex.
    */
    for (var i = 0; i < points.length; i++) {
        points[i].culled = false;
    }
    
    // NOTE: REMEMBER TO BUILD THE EDGES WHEN ADDING NEW MESHES!
    // Generates the array of edges.
    /* edges is an int[2] with properties:
     *  int state
     * edges stores the indices of the vertices.
     * state = -1 -> culled.  state = 0 -> passed.  state = 1 -> intersected.
    */
    for (var i = 0; i < mesh.edges.length; i++) {
        edges.push([mesh.edges[i][2], mesh.edges[i][3]]);
        edges[i].state = 0; // -1 = culled, 0 = pass, 1 = intersect.
    }
    
    // Generates the array of faces.
    /* faces is an int[3] with properties:
     *  bool culled
     *  int[3] edges
     * faces stores the indices of the vertices.
    */
    for (var i = 0; i < mesh.faces.length; i++) {
        faces.push(mesh.faces[i].points.slice());
        faces[i].normal = mesh.faces[i].normal.slice();
        faces[i].culled = false;
        
        var faceEdges = [];
        // TODO: Figure out why faceEdges doesn't contain the right values.  Uncomment the two console.logs to see the issue.
        for (var j = edges.length - 1; j >= 0; j--) {
            if (contains3c(faces[i], edges[j][0]) && contains3c(faces[i], edges[j][1])) {
                var exists = false;
                for (var k = faceEdges.length - 1; k >= 0; k--) {
                    if (equals2i(edges[faceEdges[k]], edges[j])) {
                        exists = true;
                    }
                }
                if (!exists) {
                    faceEdges.push(j);
                }
            }
        }
        faces[i].edges = faceEdges;
    }
    
    // generate set of planes from the cell.
    var cellPlanes = cellToPlanes(cell, center);
    
    // now clip mesh on each plane.
    for (var i = cellPlanes.length - 1; i >= 0; --i) {
        // process points
        for (var j = points.length - 1; j >= 0; --j) {
            if (!points[j].culled) {
                points[j].culled = dot3(cellPlanes[i].normal, sub3(points[j], cellPlanes[i].p)) < 0;
            }
        }
        
        // process edges
        // NOTE: In cases where the edge crosses the plane, the culled point should always be edges[j][1] for consistency.
        for (var j = edges.length - 1; j >= 0; --j) {
            if (edges[j].state == -1) {
                continue;   // doing this so the entire body of the loop isn't indented further.
            }
            var p1 = points[edges[j][0]];
            var p2 = points[edges[j][1]];
            if (p1.culled && p2.culled) {
                edges[j].state = -1;
            } else if (p1.culled) {
                edges[j].state = 1;
                
                var temp = edges[j][0];
                edges[j][0] = edges[j][1];
                edges[j][1] = temp;
                
                var tempp = p1;
                p1 = p2;
                p2 = tempp;
            } else if (p2.culled) {
                edges[j].state = 1;
            } else {
                edges[j].state = 0;
            }
            
            // Calculate intersection for new point (p1 is not culled, p2 is).
            if (edges[j].state == 1) {
                var v = normalize3(sub3(p2, p1));
                var p = add3(p1, mult3c(v, -(dot3(p1, cellPlanes[i].normal) + cellPlanes[i].d) / dot3(v, cellPlanes[i].normal)));
                p.culled = false;
                
                points.push(p);
                edges[j][1] = points.length - 1;
            }
        }
        
        var newFaceEdges = [];
        // process faces (need to close, and possibly triangulate)
        for (var j = faces.length - 1; j >= 0; --j) {
            if (faces[j].culled) {
                continue;   // skip if current face is culled.
            }
            var e1 = edges[faces[j].edges[0]];
            var e2 = edges[faces[j].edges[1]];
            var e3 = edges[faces[j].edges[2]];
            
            // NOTE: we don't need to worry about resetting state to 0 for state=1 edges because we only ignore state=-1 edges.
            if (e1.state == -1 && e2.state == -1 && e3.state == -1) {   // if all edges are culled, do nothing.
                faces[j].culled = true;
            } else if (e1.state == -1 || e2.state == -1 || e3.state == -1) {    // if one edge is culled (there should never be two), then make a new edge using the other two edges.
                var newEdge = [];   // NOTE: newEdge will be at index edges.length when pushed onto edges.
                // one state should be -1, two should be 1
                if (e1.state == -1) {
                    newEdge = [e2[1], e3[1]];
                    faces[j].edges[0] = edges.length;
                    faces[j][0] = e2[0];
                    faces[j][1] = e2[1];
                    faces[j][2] = e3[1];
                } else if (e2. state == -1) {
                    newEdge = [e1[1], e3[1]];
                    faces[j].edges[1] = edges.length;
                    faces[j][0] = e1[0];
                    faces[j][1] = e1[1];
                    faces[j][2] = e3[1];
                } else {
                    newEdge = [e2[1], e1[1]];
                    faces[j].edges[2] = edges.length;
                    faces[j][0] = e2[0];
                    faces[j][1] = e2[1];
                    faces[j][2] = e1[1];
                }
                
                newEdge.state = 0;
                edges.push(newEdge);
                newFaceEdges.push({edge:newEdge, index:edges.length - 1});
            } else if (e1.state == 1 || e2.state == 1 || e3.state == 1) {   // if two edges intersect (there should never be one), then make new edge and triangulate.
                var idx1, idx2, idx3;
                // two states should be 1, one should be 0.
                if (e1.state == 0) {
                    idx1 = 0;
                    idx2 = 1;
                    idx3 = 2;
                } else if (e2. state == 0) {
                    idx1 = 1;
                    idx2 = 2;
                    idx3 = 0;
                } else {
                    idx1 = 2;
                    idx2 = 0;
                    idx3 = 1;
                }
                // swapped the indices so that e1 will always be the one above.
                e1 = edges[faces[j].edges[idx1]];
                e2 = edges[faces[j].edges[idx2]];
                e3 = edges[faces[j].edges[idx3]];
                
                var newEdge = [e2[1], e3[1]];   // the edge along the plane. Index edges.length.
                newEdge.state = 0;
                
                var newEdge2 = [e2[0], e3[1]];  // the edge to triangulate with.  Index edges.length + 1.
                newEdge2.state = 0;
                
                var newFace = [e2[0], e3[1], e2[1]];
                newFace.edges = [faces[j].edges[idx2], edges.length, edges.length + 1]
                newFace.culled = false;
                newFace.normal = faces[j].normal.slice();
                
                // update the old face.
                faces[j].edges[idx2] = edges.length + 1;
                faces[j][0] = e2[0];
                faces[j][1] = e3[0];
                faces[j][2] = e3[1];
                
                edges.push(newEdge);
                newFaceEdges.push({edge:newEdge, index:edges.length - 1});
                
                edges.push(newEdge2);
                
                faces.push(newFace);
            }
        }
        // sort the newFaceEdges into connected order (arbitrarily clockwise/counterclockwise) so we can triangulate it more easily.

        for (var j = newFaceEdges.length - 2; j >= 0; j--) {
            for (var k = j; k >= 0; k--) {
                if (newFaceEdges[k].edge[1] == newFaceEdges[j + 1].edge[0] || newFaceEdges[k].edge[0] == newFaceEdges[j + 1].edge[0]) {
                    // flip the edge if it's backwards.  We want a-b b-c c-d
                    var temp = newFaceEdges[j];
                    if (newFaceEdges[k].edge[0] == newFaceEdges[j + 1].edge[0]) {
                        newFaceEdges[k].edge = flipEdge(newFaceEdges[k].edge);
                    }
                    newFaceEdges[j] = newFaceEdges[k];
                    if (k != j) {
                        newFaceEdges[k] = temp;
                    }
                    break;
                }
            }
        }
        
        // Triangulates the new faces.
        if (newFaceEdges.length > 0) {
            var lastEdge = newFaceEdges[0];
            for (var j = 1; j < newFaceEdges.length - 2; j++) {
                var newEdge = [lastEdge.edge[0], newFaceEdges[j].edge[1]];
                newEdge.state = 0;
                edges.push(newEdge);
                
                var newFace = [lastEdge.edge[0], lastEdge.edge[1], newFaceEdges[j].edge[1]];
                newFace.edges = [lastEdge.index, newFaceEdges[j].index, edges.length - 1];
                newFace.culled = false;
                // the normals for these faces are all just the negative normal of the plane.
                
                newFace.normal = mult3c(cellPlanes[i].normal, -1);
                faces.push(newFace);
                
                lastEdge.edge = newEdge;
                lastEdge.index = edges.length - 1;
            }
            
            var newFace = [lastEdge.edge[0], lastEdge.edge[1], newFaceEdges[newFaceEdges.length - 2].edge[1]];
            newFace.edges = [lastEdge.index, newFaceEdges[newFaceEdges.length - 2].index, newFaceEdges[newFaceEdges.length - 1].index];
            newFace.culled = false;
            newFace.normal = mult3c(cellPlanes[i].normal, -1);
            faces.push(newFace);
        }
    }
    
    //console.log(faces);
    var newPoints = [];
    var newFaces = [];
    // TODO: iterate through points and faces, pushing the non-culled ones into newPoints/Faces, and updating the face indices appropriately.
    var points_mapping = [];
    for (var i = 0, j = 0; i < points.length; i++) {
        if (!points[i].culled) {
            var p = points[i];
            newPoints[j] = [p[0], p[1], p[2]];
            points_mapping[i] = j;
            j++;
        }
    }
    for (var i = 0, j = 0; i < faces.length; i++) {
        if (!faces[i].culled) {
            var f = faces[i];
            if (dot3(cross3(sub3(points[f[0]], points[f[2]]), sub3(points[f[1]], points[f[2]])), faces[i].normal) < 0) {
            
                newFaces[j] = [points_mapping[f[0]],
                           points_mapping[f[2]],
                           points_mapping[f[1]]];
            } else {
                newFaces[j] = [points_mapping[f[0]],
                           points_mapping[f[1]],
                           points_mapping[f[2]]];
           }
            j++;
        }
    }
    
    return {points: newPoints, faces: newFaces};
};

function webGLStart() {
    // by default generate a full screen canvas with automatic resize
    var gl = CubicVR.init();
    var canvas = CubicVR.getCanvas();

    if (!gl) {
        alert("Sorry, no WebGL support.");
        return;
    };

    var cl = clInit();

    // New scene with our canvas dimensions and default camera with FOV 80
    var scene = new CubicVR.Scene({
        camera: {
            width: canvas.width,
            height: canvas.height,
            fov: 80,
            position: [5, 5, -5],
            target: [0, -3, 0]
        },
        light: [
        //{ type: "directional", intensity: 0.3, direction: [-0.5, -1, 0] },
        //{ type: "directional", intensity: 0.7, direction: [ 0.5, -1, 0] },
        {
            type: "area",
            intensity: 0.9,
            mapRes: 2048,
            areaCeiling: 40,
            areaFloor: -40,
            areaAxis: [-2,-2], // specified in degrees east/west north/south
            distance: 60
        },
        ]
    });

    CubicVR.setSoftShadows(true);

    var floorMesh = new CubicVR.Mesh({
        primitive: {
            type: "box",
            size: 1.0,
            material: {
                color: [0.9, 0.8, 0.7]
            },
        },
        compile:true
    });

    var floorObject = new CubicVR.SceneObject({
        name: "floor",
        mesh: floorMesh,
        scale: [100, 0.2, 100],
        position: [0, -5, 0],
    });

    floorObject.shadowCast = false;

    // init physics manager
    var physics = new CubicVR.ScenePhysics();

    // create floor rigid body
    var rigidFloor = new CubicVR.RigidBody(floorObject, {
        type: "static",
        collision: {
            type: "box",
            size: floorObject.scale
        }
    });
    // bind floor to physics
    physics.bind(rigidFloor);

    // Add SceneObject containing the mesh to the scene
    scene.bind(floorObject);

    // initialize a mouse view controller
    mvc = new CubicVR.MouseViewController(canvas, scene.camera);

    // Add our scene to the window resize list
    CubicVR.addResizeable(scene);

    var objlist = generateObjects();
    spawnObjects(scene,physics,objlist);

    fracturePattern = loadFracturePattern();
    clSetCells(cl, fracturePattern, 0.5);
    
    updateGeoStats(scene);
    
    var pickConstraint = null;
    var mouseMode = 0;
    var pickDist = 0;

    var addMeshToScene = function(name, obj, rigid, fracPos, isx) {
        // Create new mesh
        // Intersect each fracture pattern with hull to generate a new hull.
        // Alternatively, intersect mesh with obj.mesh to generate a new mesh.

        var t0 = performance.now();

        var m = new CubicVR.Mesh({
            name: name + "m",
            //wireframe: true,
            buildWireframe: true,
            wireframeMaterial: {
                color: [1.0, 1.0, 1.0]
            }
        });
        m.build({
            points: isx.points,
            faces: isx.faces,
            material: {
                color: [1.0, 1.0, 1.0]
            }
        });
        m.buildEdges();
        m.calcNormals();
        m.compile();

        var t1 = performance.now();

        // Create new scene object
        var o = new CubicVR.SceneObject({
            name: name + "o",   
            mesh: m,
            wireframe: wireframe,
            position:[obj.position[0] + fracPos[0], obj.position[1] + fracPos[1], obj.position[2] + fracPos[2]],
            rotation:[0,0,0]//obj.rotation.slice(0), //copy of the obj's rotation.
        });

        var t2 = performance.now();

        // Create new collision map
        var coll = new CubicVR.CollisionMap({
            //type: CubicVR.enums.collision.shape.CONVEX_HULL,
            type: CubicVR.enums.collision.shape.MESH,
            //type: CubicVR.enums.collision.shape.BOX,
            //size: isx.size,
            mesh: m,
        });

        var t3 = performance.now();

        // Create new rigid body
        // Need to pass in the linear and angular velocity as well.
        var r = new CubicVR.RigidBody(o, {
            name: name + "r",
            type: "dynamic",
            mass: 1,
            collision: coll
        });
        var lvel = rigid.getLinearVelocity();
        var avel = rigid.getAngularVelocity();
        // Conserve the linear momentum of the new pieces by adding in the
        //     angular velocity term. This implementationn seems to work...
        //     pretty well? The method comes from Bullet:
        // http://bulletphysics.org/Bullet/BulletFull/btRigidBody_8h_source.html#l00374
        var lvelrot = cross3(avel, fracPos);
        r.setLinearVelocity(add3(lvel, lvelrot));
        r.setAngularVelocity(avel);

        var t4 = performance.now();

        console.log("      v  time_newmesh:       " + (t1 - t0));
        console.log("      v  time_newobject:     " + (t2 - t1));
        console.log("      v  time_newcollision:  " + (t3 - t2));
        console.log("      v  time_newrigidbody:  " + (t4 - t3));
        console.log("   v  time_addMeshToScene:   " + (t4 - t0));

        scene.bind(o);
        physics.bind(r);
        //console.log(o);
    };

    var fracture = function(ray, hit) {
        var t0;
        var rigid = hit.rigidBody;
        var obj = rigid.sceneObject;
        var mesh = obj.getMesh();
        mesh.buildEdges();
        mesh.calcFaceNormals(); // face normals will be used in the clipping calculation to preserve the correct winding.
        
        // Remove the original object.
        scene.remove(obj);
        physics.remove(rigid);
        
        // Generates a debug fracture pattern mesh
        var rot = toRotationMatrix(obj.lrotation);
        var globalPos = sub3(hit.position, obj.position);
        var fractured = clFracture(cl, mesh.points, mesh.faces, rot, globalPos);

        t0 = performance.now();
        for (var i = 0; i < fracturePattern.length; i++) {
            if (!cl.proximate[i]) {
                continue;
            }

            var fracMesh = fracturePattern[i].mesh;
            var fracColl = fracturePattern[i].collision;
            var fracPos = fracturePattern[i].position;
            // Create new scene object
            fracMesh.buildWireframe = true;
            fracMesh.buildEdges();
            var o = new CubicVR.SceneObject({
                name: name + "_debug_fracture_" + i,
                mesh: fracMesh,
                position:add3(add3(obj.position, fracPos), globalPos),
                rotation:[0,0,0]//obj.rotation.slice(0), //copy of the obj's rotation.
            });
            scene.bind(o);
            o.visible = debugfracturemesh;
        }
        console.log("time_add_debug_pattern:      " + (performance.now() - t0));
        
        t0 = performance.now();
        for (var i = 0; i < fractured.length; i++) {
            var fr = fractured[i];
            if (fr) {
                var fracPos = fr.position;
                addMeshToScene(mesh.name + "_" + i, obj, rigid, fracPos, fr);
            }
        }
        console.log("time_add_shards:             " + (performance.now() - t0));
    }
    
    // Fractures the hit mesh using fracturePattern.  The geometry of the target mesh is
    //   approximated using its collision convex hull.
    var fracture_old = function(ray, hit) {
        var rigid = hit.rigidBody;
        var obj = rigid.sceneObject;
        var mesh = obj.getMesh();
        mesh.buildEdges();
        mesh.calcFaceNormals(); // face normals will be used in the clipping calculation to preserve the correct winding.
        
        // Remove the original object.
        scene.remove(obj);
        physics.remove(rigid);

        for (var i = 0; i < fracturePattern.length; i++) {
            var fracMesh = fracturePattern[i].mesh;
            var fracColl = fracturePattern[i].collision;
            var fracPos = fracturePattern[i].position;
            
            var isx = intersect(mesh, fracMesh, fracPos);
            addMeshToScene(mesh.name + "_" + i, obj, rigid, fracPos, isx);
        }
    };

    mvc.setEvents({
        mouseMove: function (ctx, mpos, mdelta, keyState) {
            if (!ctx.mdown) return;

            if (pickConstraint) {
                pickConstraint.setPosition(scene.camera.unProject(mpos[0],mpos[1],pickDist));
            } else if (mouseMode == 0) {
                ctx.orbitView(mdelta);
            } else if (mouseMode == 1) {
                ctx.panView(mdelta);
            }
        },
        mouseWheel: function (ctx, mpos, wdelta, keyState) {
            ctx.zoomView(wdelta);
        },
        mouseDown: function (ctx, mpos, keyState) {
            var rayTo = scene.camera.unProject(mpos[0],mpos[1]);
            var result = physics.getRayHit(scene.camera.position,rayTo);

            if (keyState[CubicVR.keyboard.KEY_F]) {
                if (result) {
                    fracture(rayTo, result);
                    updateGeoStats(scene);
                }
            } else if (keyState[CubicVR.keyboard.KEY_W]) {
                wireframe = !wireframe;
                for (var i = 0; i < scene.sceneObjects.length; i++) {
                    if (scene.sceneObjects[i].name != "floor") {
                        scene.sceneObjects[i].setWireframe(wireframe);
                    }
                }
            } else if (keyState[CubicVR.keyboard.KEY_D]) {
                debugfracturemesh = !debugfracturemesh;
                for (var i = 0; i < scene.sceneObjects.length; i++) {
                    if (scene.sceneObjects[i].name.indexOf("debug_fracture") > -1) {
                        scene.sceneObjects[i].visible = debugfracturemesh;
                    }
                }
            } else if (result && !pickConstraint) {
                pickConstraint = new CubicVR.Constraint({
                    type: CubicVR.enums.physics.constraint.P2P,
                    rigidBody: result.rigidBody,
                    positionA: result.localPosition
                });

                physics.addConstraint(pickConstraint);
                pickDist = CubicVR.vec3.length(CubicVR.vec3.subtract(scene.camera.position,result.position));
                pickConstraint.setPosition(scene.camera.unProject(mpos[0],mpos[1],pickDist));
            }
            if (keyState[CubicVR.keyboard.ALT]) {
                mouseMode = 1;
            } else {
                mouseMode = 0;
            }

        },
        mouseUp: function(ctx, mpos, keyState) {
            if (pickConstraint) {
                physics.removeConstraint(pickConstraint);
                pickConstraint = null;
            }
        },
        keyDown: null,
        keyUp: null
    });

    window.addEventListener("keypress",function(evt) {
        if (evt.which == 114) {
            physics.reset();
        }
    },false);

    // Start our main drawing loop, it provides a timer and the gl context as parameters
    CubicVR.MainLoop(function(timer, gl) {
        stats.begin();

        physics.stepSimulation(timer.getLastUpdateSeconds());

        scene.render();

        stats.end()
    });
}
