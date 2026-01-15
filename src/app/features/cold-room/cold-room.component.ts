import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { NgForm } from '@angular/forms';

import * as THREE from 'three';
import { OrbitControls, GLTFLoader, RGBELoader } from 'three-stdlib';

type Dims = { length: number; width: number; height: number }; // x (L), z (W), y (H)

type Equip = {
  roofCondenser: boolean;
  evaporators: boolean;
  interiorLight: boolean;
  electricPanel: boolean;
};

@Component({
  selector: 'app-cold-room',
  templateUrl: './cold-room.component.html',
  styleUrls: ['./cold-room.component.css'],
})
export class ColdRoomComponent implements AfterViewInit, OnDestroy {
  @ViewChild('viewport', { static: true })
  viewportRef!: ElementRef<HTMLDivElement>;

  // datos del formulario
  dims: Dims = { length: 0, width: 0, height: 0 }; // usuario obligado a digitar
  equip: Equip = {
    roofCondenser: false,
    evaporators: false,
    interiorLight: false,
    electricPanel: false,
  };

  // three.js
  private renderer: any;
  private scene: any;
  private camera: any;
  private controls: any;
  private animId = 0;

  private roomGroup = new THREE.Group();
  private equipGroup = new THREE.Group();
  private frontGroup = new THREE.Group();

  // loaders
  private gltfLoader = new GLTFLoader();
  private textureLoader = new THREE.TextureLoader();
  private envLoaded = false;
  frontVisible = true; // true = pared frontal visible (cuarto cerrado)

  ngAfterViewInit(): void {
    this.initThree();
    // no construimos el cuarto hasta que haya dimensiones válidas
    this.loop();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animId);
    this.controls?.dispose();
    this.renderer?.dispose();
  }

  // ---------------------------------------------------------------------------
  // INIT THREE
  // ---------------------------------------------------------------------------
  private initThree() {
    const host = this.viewportRef.nativeElement;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // sombras suaves
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#eef1f5');

    const aspect = host.clientWidth / Math.max(1, host.clientHeight);
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 200);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    // Ajustamos cámara y controles según las dimensiones actuales
    this.updateCameraFraming();

    // luces base
    const ambient = new THREE.AmbientLight(0xffffff, 0.2);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xf5f7fa, 0xb0b4bb, 0.35);
    hemi.position.set(0, this.dims.height * 1.5, 0);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 0.55);
    dir.position.set(10, 12, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 50;
    this.scene.add(dir);

    // piso exterior
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      new THREE.MeshStandardMaterial({ color: 0xf4f6f9, roughness: 0.96 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // environment HDR (opcional: requiere assets/hdr/warehouse.hdr)
    this.loadEnvironment();

    // resize
    window.addEventListener('resize', () => {
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || 400;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    });
  }

  // ---------------------------------------------------------------------------
  // ENVIRONMENT MAP (opcional – si no existe el HDR solo fallará en consola)
  // ---------------------------------------------------------------------------
  private loadEnvironment() {
    if (this.envLoaded) return;
    this.envLoaded = true;

    const pmremGen = new THREE.PMREMGenerator(this.renderer);
    pmremGen.compileEquirectangularShader();

    new RGBELoader().setPath('assets/hdr/').load(
      'warehouse.hdr',
      (hdr: any) => {
        const envMap = pmremGen.fromEquirectangular(hdr).texture;
        this.scene.environment = envMap;
        // mantenemos fondo plano, pero podrías usar envMap también
        hdr.dispose();
        pmremGen.dispose();
      },
      undefined,
      () => {
        // si no encuentra el HDR, simplemente seguimos sin environment
        console.warn('HDR environment not found, skipping.');
      }
    );
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  private addEdges(mesh: any, color = 0x333333) {
    const geo = mesh.geometry as any;
    const edges = new (THREE as any).EdgesGeometry(geo);
    const lineMat = new (THREE as any).LineBasicMaterial({ color });
    const lines = new (THREE as any).LineSegments(edges, lineMat);
    mesh.add(lines);
  }

  private loadModel(
    path: string,
    opts: {
      position?: any;
      rotation?: any;
      scale?: number | any;
      parent?: any;
    } = {}
  ) {
    const parent = opts.parent ?? this.scene;

    this.gltfLoader.load(
      path,
      (gltf: any) => {
        const root = gltf.scene;
        console.log('GLB cargado OK:', path, root);
        root.traverse((o: any) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });

        if (opts.position) root.position.copy(opts.position);
        if (opts.rotation) root.rotation.copy(opts.rotation);
        if (opts.scale) {
          if (typeof opts.scale === 'number') {
            root.scale.setScalar(opts.scale);
          } else {
            root.scale.copy(opts.scale);
          }
        }

        parent.add(root);
      },
      undefined,
      (err: any) => {
        console.warn('No se pudo cargar el modelo', path, err);
      }
    );
  }

  // ---------------------------------------------------------------------------
  // RECONSTRUIR ESCENA
  // ---------------------------------------------------------------------------
  private rebuildRoom() {
    this.roomGroup.clear();
    this.scene.remove(this.roomGroup);

    this.buildRoomPanels();
    this.scene.add(this.roomGroup);
  }

  private rebuildEquip() {
    this.equipGroup.clear();
    this.scene.remove(this.equipGroup);

    this.buildEquipment();
    this.scene.add(this.equipGroup);
  }

  buildScene() {
    if (!this.isDimsValid()) return;

    this.rebuildRoom();
    this.rebuildEquip();
    this.updateCameraFraming();
  }

  onDimsChange() {
    // el usuario va escribiendo; solo reaccionamos cuando ya son valores > 0
    if (!this.isDimsValid()) return;

    this.rebuildRoom();
    this.rebuildEquip();
    this.updateCameraFraming();
  }

  isDimsValid(): boolean {
    const { length, width, height } = this.dims;
    return length > 0 && width > 0 && height > 0;
  }

  onEquipChange() {
    // Solo cambia qué equipos se muestran
    this.rebuildEquip();
  }

  resetAll(form: NgForm) {
    // 1) reset de datos del formulario
    this.dims = { length: 0, width: 0, height: 0 };

    // si quieres dejar los equipos tildados por defecto:
    this.equip = {
      roofCondenser: false,
      evaporators: false,
      interiorLight: false,
      electricPanel: false,
    };

    // sincronizar con el formulario template-driven
    form.resetForm({
      length: this.dims.length,
      width: this.dims.width,
      height: this.dims.height,
      roofCondenser: this.equip.roofCondenser,
      evaporators: this.equip.evaporators,
      interiorLight: this.equip.interiorLight,
      electricPanel: this.equip.electricPanel,
    });

    // 2) limpiar geometría del cuarto/equipos
    this.roomGroup.clear();
    this.equipGroup.clear();
    this.scene.remove(this.roomGroup, this.equipGroup);

    // 3) devolver cámara a una vista neutra
    if (this.camera && this.controls) {
      this.camera.position.set(7, 4.5, 8); // vista “default”
      this.controls.target.set(0, 1.5, 0);
      this.controls.update();
    }
  }

  selectAll(event: FocusEvent) {
    const input = event.target as HTMLInputElement;
    input.select();
  }

  toggleFront() {
    this.frontVisible = !this.frontVisible;
    if (this.frontGroup) {
      this.frontGroup.visible = this.frontVisible;
    }
  }

  // ---------------------------------------------------------------------------
  // CUARTO FRÍO (paneles, frente abierto, marco frontal)
  // ---------------------------------------------------------------------------
  private buildRoomPanels() {
    const t = 0.12; // espesor panel
    const { length: L, width: W, height: H } = this.dims;

    // grupo del frente (pared + puerta)
    this.frontGroup = new THREE.Group();

    let normalMap: any = null;
    try {
      normalMap = this.textureLoader.load('assets/textures/panel-normal.jpg');
    } catch {
      // si no existe, seguimos sin normal map
    }

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xe7edf3, // gris un poco más “frío”
      roughness: 0.55, // menos áspero → refleja mejor la luz
      metalness: 0.15,
      normalMap: normalMap ?? undefined,
    });

    const trimMat = new THREE.MeshStandardMaterial({
      color: 0xd4d9df, // leve contraste con panel
      roughness: 0.45,
      metalness: 0.18,
    });

    // suelo interior
    const floor = new THREE.Mesh(new THREE.BoxGeometry(L, t, W), wallMat);
    floor.position.set(0, t / 2, 0);
    floor.receiveShadow = true;
    this.roomGroup.add(floor);

    // techo exterior (placa superior)
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(L, t, W), wallMat);
    ceil.position.set(0, H - t / 2, 0);
    ceil.castShadow = true;
    ceil.receiveShadow = true;
    this.addEdges(ceil);
    this.roomGroup.add(ceil);

    // revestimiento interior del techo (lámina interna)
    const innerCeilMat = wallMat.clone();
    innerCeilMat.roughness = 0.6; // un poquito distinto si quieres
    innerCeilMat.metalness = 0.1;
    (innerCeilMat as any).side = THREE.DoubleSide;

    const innerCeil = new THREE.Mesh(
      new THREE.PlaneGeometry(L, W),
      innerCeilMat
    );

    // Plano horizontal, mirando hacia abajo y arriba
    innerCeil.rotation.x = Math.PI / 2;

    // Justo por debajo del techo exterior (lado interior del cuarto)
    innerCeil.position.set(0, H - t, 0);

    innerCeil.receiveShadow = true;
    innerCeil.castShadow = true; // para bloquear la luz interior hacia el techo exterior
    this.roomGroup.add(innerCeil);

    // pared izquierda
    const left = new THREE.Mesh(new THREE.BoxGeometry(t, H, W), wallMat);
    left.position.set(-L / 2 + t / 2, H / 2, 0);
    left.castShadow = true;
    left.receiveShadow = true;
    this.addEdges(left);
    this.roomGroup.add(left);

    // pared derecha
    const right = new THREE.Mesh(new THREE.BoxGeometry(t, H, W), wallMat);
    right.position.set(L / 2 - t / 2, H / 2, 0);
    right.castShadow = true;
    right.receiveShadow = true;
    this.addEdges(right);
    this.roomGroup.add(right);

    // pared trasera
    const back = new THREE.Mesh(new THREE.BoxGeometry(L, H, t), wallMat);
    back.position.set(0, H / 2, -W / 2 + t / 2);
    back.castShadow = true;
    back.receiveShadow = true;
    this.addEdges(back);
    this.roomGroup.add(back);

    // zócalo
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(L + 0.12, 0.06, W + 0.12),
      trimMat
    );
    trim.position.set(0, 0.03, 0);
    trim.receiveShadow = true;
    this.roomGroup.add(trim);

    // marco frontal superior (para que se vea como cajón)
    const frameTop = new THREE.Mesh(
      new THREE.BoxGeometry(L + 0.1, 0.12, 0.12),
      trimMat
    );
    frameTop.position.set(0, H - 0.06, W / 2 + 0.06);
    this.addEdges(frameTop);
    this.roomGroup.add(frameTop);

    // --------------------------------------------------------------
    // PARED FRONTAL COMPLETA + PUERTA (todo dentro de frontGroup)
    // --------------------------------------------------------------
    const frontZ = W / 2 - t / 2;

    // pared frontal
    const frontWall = new THREE.Mesh(new THREE.BoxGeometry(L, H, t), wallMat);
    frontWall.position.set(0, H / 2, frontZ);
    frontWall.castShadow = true;
    frontWall.receiveShadow = true;
    this.addEdges(frontWall);
    this.frontGroup.add(frontWall);

    // PUERTA DEL CUARTO (más realista, hacia el exterior)
    const doorW = 0.9;
    const doorH = 1.9;
    const doorThickness = 0.08;

    const doorMat = new THREE.MeshStandardMaterial({
      color: 0xf3f4f6,
      roughness: 0.45,
      metalness: 0.08,
    });

    // Pivot en bisagra (pared frontal izquierda)
    const hingeX = -L / 2 + 0.15; // separación desde la esquina
    const hingeZ = W / 2 + doorThickness / 2; // justo por fuera de la pared frontal

    const doorGroup = new THREE.Group();
    doorGroup.position.set(hingeX, doorH / 2, hingeZ);

    // Si quieres que inicie un poco abierta, descomenta:
    // doorGroup.rotation.y = -Math.PI / 10;

    this.frontGroup.add(doorGroup);

    // Marco alrededor de la puerta
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(doorW + 0.06, doorH + 0.06, 0.05),
      trimMat
    );
    frame.position.set(doorW / 2, 0, -0.015);
    frame.castShadow = true;
    frame.receiveShadow = true;
    this.addEdges(frame);
    doorGroup.add(frame);

    // Hoja de la puerta
    const doorLeaf = new THREE.Mesh(
      new THREE.BoxGeometry(doorW, doorH, doorThickness),
      doorMat
    );
    doorLeaf.position.set(doorW / 2, 0, 0);
    doorLeaf.castShadow = true;
    doorLeaf.receiveShadow = true;
    this.addEdges(doorLeaf);
    doorGroup.add(doorLeaf);

    // Manija
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.16, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0x444444,
        metalness: 0.7,
        roughness: 0.3,
      })
    );
    handle.position.set(doorW - 0.15, 0.1, doorThickness / 2 + 0.02);
    handle.castShadow = true;
    doorGroup.add(handle);

    // Umbral en el piso
    const threshold = new THREE.Mesh(
      new THREE.BoxGeometry(doorW + 0.05, 0.04, 0.12),
      trimMat
    );
    threshold.position.set(hingeX + doorW / 2, 0.02, W / 2 + 0.06);
    threshold.receiveShadow = true;
    this.frontGroup.add(threshold);

    // Visibilidad del frente según el estado (cerrado/abierto)
    this.frontGroup.visible = this.frontVisible;
    this.roomGroup.add(this.frontGroup);
  }

  // ---------------------------------------------------------------------------
  // EQUIPOS (primitivas + modelos GLB si existen)
  // ---------------------------------------------------------------------------
  private buildEquipment() {
    const { length: L, width: W, height: H } = this.dims;

    // UNIDAD CONDENSADORA (techo)
    if (this.equip.roofCondenser) {
      // primitivo simple (por si no hay modelo)
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.6, 0.7),
        new THREE.MeshStandardMaterial({
          color: 0xdfe3e6,
          roughness: 0.7,
          metalness: 0.1,
        })
      );
      body.position.set(0, H + 0.5, -W / 2 - 0.5);
      body.castShadow = true;
      body.receiveShadow = true;
      this.addEdges(body);
      this.equipGroup.add(body);

      const fan = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.06, 32),
        new THREE.MeshStandardMaterial({ color: 0x222222 })
      );
      fan.rotation.x = Math.PI / 2;
      fan.position.set(0.35, H + 0.5, -W / 2 - 0.9);
      fan.castShadow = true;
      this.equipGroup.add(fan);

      // modelo GLB (si lo tienes en assets/models/rooftop_condenser.glb)
      this.loadModel(
        'assets/models/outdoor_central_ac_air_conditioner_unit.glb',
        {
          position: new THREE.Vector3(0, H + 0.5, -W / 2 - 0.5),
          scale: 0.9,
          parent: this.equipGroup,
        }
      );
    }

    // EVAPORADORES (interior)
    if (this.equip.evaporators) {
      const unitCount = 3;
      const evapMat = new THREE.MeshStandardMaterial({
        color: 0xe3e8ee,
        roughness: 0.65,
        metalness: 0.1,
      });

      for (let i = 0; i < unitCount; i++) {
        const x = -L / 2 + 0.8 + i * ((L - 1.6) / (unitCount - 1));
        const y = H - 0.6;
        const z = W / 2 - 0.4;

        // primitivo
        const evap = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 0.28, 0.28),
          evapMat
        );
        evap.position.set(x, y, z);
        evap.castShadow = true;
        evap.receiveShadow = true;
        this.addEdges(evap);
        this.equipGroup.add(evap);

        const fan = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.12, 0.06, 24),
          new THREE.MeshStandardMaterial({
            color: 0x1e1e1e,
            metalness: 0.6,
            roughness: 0.4,
          })
        );
        fan.rotation.z = Math.PI / 2;
        fan.position.set(x, y, z - 0.2);
        fan.castShadow = true;
        this.equipGroup.add(fan);

        // modelo GLB (si lo tienes en assets/models/evaporator.glb)
        this.loadModel('assets/models/evaporator.glb', {
          position: new THREE.Vector3(x, y, z),
          rotation: new THREE.Euler(0, Math.PI, 0),
          scale: 0.7,
          parent: this.equipGroup,
        });
      }
    }

    // LUZ INTERIOR
    if (this.equip.interiorLight) {
      const y = H - 0.3;

      // Luz puntual que ilumina el interior
      const bulb = new (THREE as any).PointLight(0xffffff, 1.6, 6, 2);
      bulb.position.set(0, y - 0.15, 0);
      bulb.castShadow = true;
      this.equipGroup.add(bulb);

      // Cargar la lámpara GLB
      this.loadModel('assets/models/ceiling_lamp_10mb.glb', {
        position: new THREE.Vector3(0, y - 0.08, 0),
        parent: this.equipGroup,
        // OJO: la rotación la vamos a aplicar dentro de loadModel
        // para poder “probar” ángulos fácilmente.
      });
    }

    // TABLERO ELÉCTRICO
    if (this.equip.electricPanel) {
      // Posición general del tablero sobre el muro lateral izquierdo
      const panelOffset = 0.22;
      const panelHeight = 1.4;

      // Centro de la pared izquierda, ligeramente hacia la parte frontal (z > 0)
      const panelGroup = new THREE.Group();
      panelGroup.position.set(
        -L / 2 - panelOffset, // pegado por fuera de la pared izquierda
        panelHeight,
        W * 0.15 // un poco hacia el frente (ajusta a gusto)
      );

      // Hacemos que el frente del tablero mire hacia -X (vista lateral)
      panelGroup.rotation.y = -Math.PI / 2;

      this.equipGroup.add(panelGroup);

      // Cuerpo principal (caja metálica)
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.55, 0.14),
        new THREE.MeshStandardMaterial({
          color: 0xd9dde3,
          roughness: 0.55,
          metalness: 0.18,
        })
      );
      body.castShadow = true;
      body.receiveShadow = true;
      this.addEdges(body);
      panelGroup.add(body);

      // Puerta delantera (ligeramente sobresalida)
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.5, 0.02),
        new THREE.MeshStandardMaterial({
          color: 0xf5f6f8,
          roughness: 0.4,
          metalness: 0.1,
        })
      );
      // La puerta se adelanta un poco en eje X
      door.position.set(0.03, 0, 0.07);
      door.castShadow = true;
      panelGroup.add(door);

      // Marco hundido en la puerta (para más detalle)
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.44, 0.005),
        new THREE.MeshStandardMaterial({
          color: 0xe1e4ea,
          roughness: 0.5,
          metalness: 0.08,
        })
      );
      frame.position.set(0.035, 0, 0.082);
      panelGroup.add(frame);

      // Manija
      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.12, 0.03),
        new THREE.MeshStandardMaterial({
          color: 0x555555,
          metalness: 0.6,
          roughness: 0.3,
        })
      );
      handle.position.set(0.11, 0, 0.085);
      handle.castShadow = true;
      panelGroup.add(handle);

      // Tres luces indicadoras (leds) en la parte superior
      const ledMatGreen = new THREE.MeshStandardMaterial({
        color: 0x6dd36b,
        emissive: 0x6dd36b,
        emissiveIntensity: 1.2,
        roughness: 0.4,
        metalness: 0.1,
      });
      const ledMatYellow = new THREE.MeshStandardMaterial({
        color: 0xf3c969,
        emissive: 0xf3c969,
        emissiveIntensity: 1.2,
        roughness: 0.4,
        metalness: 0.1,
      });
      const ledMatRed = new THREE.MeshStandardMaterial({
        color: 0xe66c6c,
        emissive: 0xe66c6c,
        emissiveIntensity: 1.2,
        roughness: 0.4,
        metalness: 0.1,
      });

      const ledGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.01, 16);

      const ledY = 0.18;
      const ledZ = 0.085;

      const ledGreen = new THREE.Mesh(ledGeo, ledMatGreen);
      ledGreen.rotation.x = Math.PI / 2;
      ledGreen.position.set(-0.04, ledY, ledZ);
      panelGroup.add(ledGreen);

      const ledYellow = new THREE.Mesh(ledGeo, ledMatYellow);
      ledYellow.rotation.x = Math.PI / 2;
      ledYellow.position.set(0, ledY, ledZ);
      panelGroup.add(ledYellow);

      const ledRed = new THREE.Mesh(ledGeo, ledMatRed);
      ledRed.rotation.x = Math.PI / 2;
      ledRed.position.set(0.04, ledY, ledZ);
      panelGroup.add(ledRed);

      // Si tienes un modelo GLB, lo montamos igual sobre el grupo (opcional)
      this.loadModel('assets/models/electrical_panel.glb', {
        position: new THREE.Vector3(0, 0, 0),
        rotation: new THREE.Euler(0, Math.PI / 2, 0),
        scale: 0.6,
        parent: panelGroup,
      });
    }

    // RACKS (ejemplo: dos dentro del cuarto)
    const rackY = 0; // ajusta según tu modelo
    const rackZ = 0;
    const rackOffsetX = 0.9;

    this.loadModel('assets/models/rack.glb', {
      position: new THREE.Vector3(-rackOffsetX, rackY, rackZ),
      scale: 0.8,
      parent: this.roomGroup,
    });
    this.loadModel('assets/models/rack.glb', {
      position: new THREE.Vector3(rackOffsetX, rackY, rackZ),
      scale: 0.8,
      parent: this.roomGroup,
    });
  }

  // ---------------------------------------------------------------------------
  // CÁMARA / CONTROLES SEGÚN DIMENSIONES
  // ---------------------------------------------------------------------------
  private updateCameraFraming() {
    if (!this.camera || !this.controls || !this.isDimsValid()) return;

    const { length: L, width: W, height: H } = this.dims;
    const maxDim = Math.max(L, W, H);

    if (maxDim <= 0) return; // aún no hay datos válidos

    const distance = maxDim * 1.6;
    const heightCam = H * 0.9;

    this.camera.position.set(distance, heightCam, distance);

    this.controls.target.set(0, H / 2, 0);
    this.controls.update();

    this.controls.minDistance = maxDim * 0.5;
    this.controls.maxDistance = maxDim * 3;
    this.controls.maxPolarAngle = Math.PI / 2.1;
  }

  // ---------------------------------------------------------------------------
  // LOOP
  // ---------------------------------------------------------------------------
  private loop = () => {
    this.animId = requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
