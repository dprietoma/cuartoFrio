import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { NgForm } from '@angular/forms';

import * as THREE from 'three';
import type { WebGLRenderer, Scene, PerspectiveCamera } from 'three';
import {
  OrbitControls,
  GLTFLoader,
  RGBELoader,
  EffectComposer,
  RenderPass,
  SSAOPass,
  SMAAPass,
} from 'three-stdlib';

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
  dims: Dims = { length: 0, width: 0, height: 0 };
  equip: Equip = {
    roofCondenser: false,
    evaporators: false,
    interiorLight: false,
    electricPanel: false,
  };

  private renderer!: WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: PerspectiveCamera;
  private controls!: OrbitControls;

  private composer?: EffectComposer;
  private ssaoPass?: SSAOPass;

  private animId = 0;

  private roomGroup = new THREE.Group();
  private equipGroup = new THREE.Group();
  private frontGroup = new THREE.Group();

  // loaders
  private gltfLoader = new GLTFLoader();
  private textureLoader = new THREE.TextureLoader();
  private envLoaded = false;

  // debug
  debugEdges = false;

  // UI
  frontVisible = true;

  // --- Piso: selector de color (default + 4 opciones) ---
  floorColor = 'gray';

  floorOptions = [
    { key: 'gray', label: 'Gris (default)', color: 0xf4f6f9 },
    { key: 'dark', label: 'Gris oscuro', color: 0x2f3440 },
    { key: 'blue', label: 'Azul industrial', color: 0x3a6ea5 },
    { key: 'green', label: 'Verde sobrio', color: 0x1f7a6b },
    { key: 'beige', label: 'Beige claro', color: 0xe7dfcf },
  ];

  private floorMesh: any; // referencia al piso exterior

  // --- Fondo: selector (default + 4 opciones) ---
  bgColor = 'default';

  bgOptions = [
    { key: 'default', label: 'Gris claro (default)', color: 0xeef1f5 },
    { key: 'white', label: 'Blanco', color: 0xffffff },
    { key: 'dark', label: 'Oscuro', color: 0x111827 },
    { key: 'blue', label: 'Azul suave', color: 0xcfe3ff },
    { key: 'studio', label: 'Gris estudio', color: 0xf5f5f5 },
  ];

  // --- Paredes: selector (default + 4 opciones) ---
  wallColor = 'default';

  wallOptions = [
    { key: 'default', label: 'Gris frío (default)', color: 0xe7edf3 },
    { key: 'white', label: 'Blanco', color: 0xf8fafc },
    { key: 'blue', label: 'Azul suave', color: 0xdbeafe },
    { key: 'green', label: 'Verde suave', color: 0xd1fae5 },
    { key: 'steel', label: 'Gris acero', color: 0xd1d5db },
  ];

  // Guardamos materiales de paneles (para cambiarles color sin reconstruir)
  private wallMats: any[] = [];

  // --- Paredes: textura JPG en select (con nombre) ---
  wallTexture = 'none';

  wallTextureOptions = [
    { key: 'none', label: 'Sin imagen (color)', url: null },
    { key: 'steel', label: 'Acero cepillado', url: 'assets/walls/steel.png' },
    {
      key: 'panel',
      label: 'Panel blanco',
      url: 'assets/walls/panel-white.jpg',
    },
    { key: 'concrete', label: 'Concreto', url: 'assets/walls/concrete.jpg' },
  ];

  advisor = {
    name: 'Juan Sebastian Villamizar',
    phone: '315 9296785',
    email: 'comercialbajoceroscolombia@gmail.com',
  };

  companyLogoUrl = 'assets/img/logo.png';

  services = [
    {
      id: '01',
      title: 'Refrigeración industrial y comercial',
      items: [],
    },
    {
      id: '02',
      title: 'Diseño de cuartos fríos',
      items: [],
    },
    {
      id: '03',
      title: 'Adecuaciones en sala de procesos',
      items: [],
    },
  ];

  // Guardamos una textura cargada para no recargar en cada cambio
  private wallTextureMap: THREE.Texture | null = null;

  // --- Camera presets ---
  private isAnimatingCamera = false;

  private animateCameraTo(
    pos: THREE.Vector3,
    target: THREE.Vector3,
    durationMs = 650,
  ) {
    if (!this.camera || !this.controls) return;

    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();

    const start = performance.now();
    this.isAnimatingCamera = true;

    const easeInOut = (t: number) =>
      t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const e = easeInOut(t);

      this.camera.position.lerpVectors(startPos, pos, e);
      this.controls.target.lerpVectors(startTarget, target, e);
      this.controls.update();

      if (t < 1) requestAnimationFrame(tick);
      else this.isAnimatingCamera = false;
    };

    requestAnimationFrame(tick);
  }

  goExteriorView() {
    if (!this.isDimsValid()) return;

    const { length: L, width: W, height: H } = this.dims;
    const maxDim = Math.max(L, W, H);

    const distance = maxDim * 1.7;
    const pos = new THREE.Vector3(distance, H * 0.95, distance);
    const target = new THREE.Vector3(0, H / 2, 0);

    this.animateCameraTo(pos, target);
  }

  goInteriorView() {
    if (!this.isDimsValid()) return;

    const { length: L, width: W, height: H } = this.dims;
    const maxDim = Math.max(L, W, H);

    // cámara dentro: un poco arriba, mirando al centro
    const pos = new THREE.Vector3(0, H * 0.65, W * 0.15);
    const target = new THREE.Vector3(0, H * 0.55, -W * 0.15);

    // si el cuarto es pequeño, acercar más
    if (maxDim < 3) pos.z = W * 0.05;

    this.animateCameraTo(pos, target);
  }

  downloadSnapshot() {
    if (!this.renderer) return;

    // Asegura que el canvas tenga el frame más reciente
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);

    const canvas = this.renderer.domElement;
    const dataUrl = canvas.toDataURL('image/png');

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `cold-room-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    a.click();
  }

  ngAfterViewInit(): void {
    this.initThree();
    this.loop();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animId);
    this.controls?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();

    // Limpieza básica de geometrías/materiales de grupos
    this.disposeGroup(this.roomGroup);
    this.disposeGroup(this.equipGroup);
  }

  // ---------------------------------------------------------------------------
  // INIT THREE (realista: ACES + luces físicas + HDR + post)
  // ---------------------------------------------------------------------------
  private initThree() {
    const host = this.viewportRef.nativeElement;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(host.clientWidth, host.clientHeight);

    // sombras
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // --- REALISMO ---
    const r: any = this.renderer;

    // Three viejo
    if ('physicallyCorrectLights' in r) r.physicallyCorrectLights = true;

    // Three nuevo
    if ('useLegacyLights' in r) r.useLegacyLights = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05; // ajusta 0.85 - 1.35
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.applyBackgroundColor();

    const aspect = host.clientWidth / Math.max(1, host.clientHeight);
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 250);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    // Ajustamos cámara y controles según dimensiones actuales
    this.updateCameraFraming();

    // luces base (con physicallyCorrectLights, intensidades son “altas”)
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xf5f7fa, 0xb0b4bb, 0.25);
    hemi.position.set(0, Math.max(3, this.dims.height * 1.5), 0);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 2.2);
    dir.position.set(10, 12, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 80;
    dir.shadow.bias = -0.00015;
    this.scene.add(dir);
    this.scene.add(dir.target);
    dir.target.position.set(0, Math.max(1, this.dims.height / 2), 0);

    // Ajusta el “frustum” de sombra según tamaño del cuarto
    const maxDim = Math.max(
      this.dims.length || 3,
      this.dims.width || 3,
      this.dims.height || 3,
    );
    const d = maxDim * 2;

    const cam = dir.shadow.camera as THREE.OrthographicCamera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 0.1;
    cam.far = 80;
    cam.updateProjectionMatrix();

    // piso exterior (lo guardamos para cambiar color en vivo)
    this.floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({
        color: 0xf4f6f9, // gris default
        roughness: 0.95,
        metalness: 0.0,
      }),
    );

    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.position.y = 0;
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);

    // aplica el color seleccionado (por defecto: gris)
    this.applyFloorColor();

    // grupos
    this.scene.add(this.roomGroup);
    this.scene.add(this.equipGroup);

    // HDR environment (si existe)
    this.loadEnvironment();

    // Postprocesado (SSAO + SMAA)
    this.setupPost(host.clientWidth, host.clientHeight);

    // resize
    window.addEventListener('resize', () => {
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || 400;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
      this.composer?.setSize(w, h);
      if (this.ssaoPass) {
        this.ssaoPass.setSize(w, h);
      }
    });
  }

  private setupPost(w: number, h: number) {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.ssaoPass = new SSAOPass(this.scene, this.camera, w, h);
    this.ssaoPass.kernelRadius = 8;
    this.ssaoPass.minDistance = 0.001;
    this.ssaoPass.maxDistance = 0.18;
    this.composer.addPass(this.ssaoPass);

    this.composer.addPass(new SMAAPass(w, h));
  }

  // ---------------------------------------------------------------------------
  // ENVIRONMENT MAP (assets/hdr/warehouse.hdr)
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
        hdr.dispose();
        pmremGen.dispose();
      },
      undefined,
      () => {
        console.warn('HDR environment not found, skipping.');
        pmremGen.dispose();
      },
    );
  }

  // ---------------------------------------------------------------------------
  // HELPERS (material PBR + edges opcional)
  // ---------------------------------------------------------------------------
  private addEdges(mesh: any, color = 0x333333) {
    if (!this.debugEdges) return;
    const edges = new THREE.EdgesGeometry(mesh.geometry);
    const lineMat = new THREE.LineBasicMaterial({ color });
    const lines = new THREE.LineSegments(edges, lineMat);
    mesh.add(lines);
  }

  private rep(meters: number) {
    // 1 repetición por metro (ajusta si tu unidad no es metro)
    return Math.max(1, Math.round(meters));
  }

  /**
   * Coloca en:
   * assets/pbr/panel/albedo.jpg
   * assets/pbr/panel/normal.jpg
   * assets/pbr/panel/roughness.jpg
   * assets/pbr/panel/metalness.jpg (opcional)
   *
   * Si no existen, igual funciona (Three solo avisará en consola).
   */
  private makePanelMaterial(repeatX: number, repeatY: number) {
    const base = 'assets/pbr/panel/';

    // Material base SIEMPRE visible (nunca negro por falta de texturas)
    const mat = new THREE.MeshStandardMaterial({
      color: 0xe7edf3,
      roughness: 0.55,
      metalness: 0.08,
    });

    const setup = (tex: THREE.Texture, isColor: boolean) => {
      tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      tex.anisotropy = Math.min(
        8,
        this.renderer?.capabilities?.getMaxAnisotropy?.() ?? 8,
      );
    };

    const load = (url: string, onOk: (t: THREE.Texture) => void) => {
      this.textureLoader.load(
        url,
        (t) => onOk(t),
        undefined,
        () => console.warn('No se pudo cargar textura:', url),
      );
    };

    load(base + 'albedo.jpg', (t) => {
      setup(t, true);
      mat.map = t;
      mat.needsUpdate = true;
    });

    load(base + 'normal.jpg', (t) => {
      setup(t, false);
      mat.normalMap = t;
      mat.needsUpdate = true;
    });

    load(base + 'roughness.jpg', (t) => {
      setup(t, false);
      mat.roughnessMap = t;
      mat.needsUpdate = true;
    });

    // opcional
    load(base + 'metalness.jpg', (t) => {
      setup(t, false);
      mat.metalnessMap = t;
      mat.needsUpdate = true;
    });

    return mat;
  }

  private makeTrimMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xd4d9df,
      roughness: 0.35,
      metalness: 0.25,
    });
  }

  private makeDoorMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xf3f4f6,
      roughness: 0.38,
      metalness: 0.1,
    });
  }

  private loadModel(
    path: string,
    opts: {
      position?: any;
      rotation?: any;
      scale?: any;
      parent?: any;
    } = {},
  ) {
    const parent = opts.parent ?? this.scene;

    this.gltfLoader.load(
      path,
      (gltf: any) => {
        const root = gltf.scene as any;
        root.traverse((o: any) => {
          if (o?.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;

            // mejora sutil: si el modelo trae materiales básicos
            if (o.material) {
              o.material.envMapIntensity = 1.0;
            }
          }
        });

        if (opts.position) root.position.copy(opts.position);
        if (opts.rotation) root.rotation.copy(opts.rotation);
        if (opts.scale) {
          if (typeof opts.scale === 'number') root.scale.setScalar(opts.scale);
          else root.scale.copy(opts.scale);
        }

        parent.add(root);
      },
      undefined,
      (err: any) => {
        console.warn('No se pudo cargar el modelo', path, err);
      },
    );
  }

  private disposeGroup(group: any) {
    group.traverse((o: any) => {
      if (o?.geometry) o.geometry.dispose?.();
      if (o?.material) {
        if (Array.isArray(o.material))
          o.material.forEach((m: any) => m.dispose?.());
        else o.material.dispose?.();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // RECONSTRUIR ESCENA
  // ---------------------------------------------------------------------------
  private rebuildRoom() {
    this.disposeGroup(this.roomGroup);
    this.roomGroup.clear();
    this.buildRoomPanels();
  }

  private rebuildEquip() {
    this.disposeGroup(this.equipGroup);
    this.equipGroup.clear();
    this.buildEquipment();
  }

  buildScene() {
    if (!this.isDimsValid()) return;
    this.rebuildRoom();
    this.rebuildEquip();
    this.updateCameraFraming();
  }

  onDimsChange() {
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
    this.rebuildEquip();
  }

  resetAll(form: NgForm) {
    this.dims = { length: 0, width: 0, height: 0 };
    this.equip = {
      roofCondenser: false,
      evaporators: false,
      interiorLight: false,
      electricPanel: false,
    };

    form.resetForm({
      length: this.dims.length,
      width: this.dims.width,
      height: this.dims.height,
      roofCondenser: this.equip.roofCondenser,
      evaporators: this.equip.evaporators,
      interiorLight: this.equip.interiorLight,
      electricPanel: this.equip.electricPanel,
    });

    this.floorColor = 'gray';
    this.applyFloorColor();

    this.bgColor = 'default';
    this.applyBackgroundColor();

    this.wallColor = 'default';
    this.applyWallColor();

    this.wallTexture = 'none';
    this.applyWallTexture();

    this.disposeGroup(this.roomGroup);
    this.disposeGroup(this.equipGroup);
    this.roomGroup.clear();
    this.equipGroup.clear();

    if (this.camera && this.controls) {
      this.camera.position.set(7, 4.5, 8);
      this.controls.target.set(0, 1.5, 0);
      this.controls.update();
    }
  }

  selectAll(event: FocusEvent) {
    (event.target as HTMLInputElement).select();
  }

  toggleFront() {
    this.frontVisible = !this.frontVisible;
    this.frontGroup.visible = this.frontVisible;
  }

  applyFloorColor() {
    if (!this.floorMesh) return;

    const opt =
      this.floorOptions.find((o) => o.key === this.floorColor) ??
      this.floorOptions[0];

    const mat: any = this.floorMesh.material;
    if (mat?.color) {
      mat.color.setHex(opt.color);
      mat.needsUpdate = true;
    }
  }

  applyBackgroundColor() {
    if (!this.scene) return;

    const opt =
      this.bgOptions.find((o) => o.key === this.bgColor) ?? this.bgOptions[0];

    this.scene.background = new THREE.Color(opt.color);
  }

  applyWallColor() {
    const opt =
      this.wallOptions.find((o) => o.key === this.wallColor) ??
      this.wallOptions[0];

    for (const m of this.wallMats) {
      if (m?.color) {
        m.color.setHex(opt.color);
        m.needsUpdate = true;
      }
    }
  }

  applyWallTexture() {
    if (!this.wallMats?.length) return;

    const opt =
      this.wallTextureOptions.find((o) => o.key === this.wallTexture) ??
      this.wallTextureOptions[0];

    // Si es "none": quitamos textura y dejamos color
    if (!opt.url) {
      this.wallTextureMap = null;
      for (const m of this.wallMats) {
        if (!m) continue;
        m.map = null;
        m.needsUpdate = true;
      }
      // Al volver a "none", aplicamos el color elegido
      this.applyWallColor();
      return;
    }

    // Cargar textura (async)
    this.textureLoader.load(
      opt.url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;

        // Repetición base: ajusta a gusto
        tex.repeat.set(2, 2);

        tex.anisotropy = Math.min(
          8,
          this.renderer?.capabilities?.getMaxAnisotropy?.() ?? 8,
        );

        this.wallTextureMap = tex;

        for (const m of this.wallMats) {
          if (!m) continue;
          m.map = tex;

          // Si quieres que la imagen “mande” y no se tiña con el color:
          m.color?.setHex(0xffffff);

          m.needsUpdate = true;
        }
      },
      undefined,
      () => console.warn('No se pudo cargar textura pared:', opt.url),
    );
  }

  // ---------------------------------------------------------------------------
  // CUARTO FRÍO (paneles + frente + puerta)
  // ---------------------------------------------------------------------------
  private buildRoomPanels() {
    const t = 0.12;
    const { length: L, width: W, height: H } = this.dims;

    // materiales PBR por orientación (repetición basada en medidas)
    const matFloor = this.makePanelMaterial(this.rep(L), this.rep(W));
    const matCeil = this.makePanelMaterial(this.rep(L), this.rep(W));
    const matSide = this.makePanelMaterial(this.rep(W), this.rep(H));
    const matBack = this.makePanelMaterial(this.rep(L), this.rep(H));
    const matFront = this.makePanelMaterial(this.rep(L), this.rep(H));

    // Guardamos refs para poder recolorear (sin reconstruir)
    this.wallMats = [matFloor, matCeil, matSide, matBack, matFront];
    this.applyWallColor();
    this.applyWallTexture();

    // sube/baja esto si quieres más reflejo del HDR
    for (const m of [matFloor, matCeil, matSide, matBack, matFront]) {
      (m as any).envMapIntensity = 1.05;
    }

    const trimMat = this.makeTrimMaterial();

    // suelo interior
    const floor = new THREE.Mesh(new THREE.BoxGeometry(L, t, W), matFloor);
    floor.position.set(0, t / 2, 0);
    floor.receiveShadow = true;
    this.roomGroup.add(floor);

    // techo exterior
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(L, t, W), matCeil);
    ceil.position.set(0, H - t / 2, 0);
    ceil.castShadow = true;
    ceil.receiveShadow = true;
    this.addEdges(ceil);
    this.roomGroup.add(ceil);

    // lámina interior del techo (para dar “caja”)
    const innerCeilMat = matCeil.clone();
    innerCeilMat.side = THREE.DoubleSide;

    const innerCeil = new THREE.Mesh(
      new THREE.PlaneGeometry(L, W),
      innerCeilMat,
    );
    innerCeil.rotation.x = Math.PI / 2;
    innerCeil.position.set(0, H - t, 0);
    innerCeil.receiveShadow = true;
    innerCeil.castShadow = true;
    this.roomGroup.add(innerCeil);

    // pared izquierda
    const left = new THREE.Mesh(new THREE.BoxGeometry(t, H, W), matSide);
    left.position.set(-L / 2 + t / 2, H / 2, 0);
    left.castShadow = true;
    left.receiveShadow = true;
    this.addEdges(left);
    this.roomGroup.add(left);

    // pared derecha
    const right = new THREE.Mesh(new THREE.BoxGeometry(t, H, W), matSide);
    right.position.set(L / 2 - t / 2, H / 2, 0);
    right.castShadow = true;
    right.receiveShadow = true;
    this.addEdges(right);
    this.roomGroup.add(right);

    // pared trasera
    const back = new THREE.Mesh(new THREE.BoxGeometry(L, H, t), matBack);
    back.position.set(0, H / 2, -W / 2 + t / 2);
    back.castShadow = true;
    back.receiveShadow = true;
    this.addEdges(back);
    this.roomGroup.add(back);

    // zócalo
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(L + 0.12, 0.06, W + 0.12),
      trimMat,
    );
    trim.position.set(0, 0.03, 0);
    trim.receiveShadow = true;
    this.roomGroup.add(trim);

    // marco frontal superior
    const frameTop = new THREE.Mesh(
      new THREE.BoxGeometry(L + 0.1, 0.12, 0.12),
      trimMat,
    );
    frameTop.position.set(0, H - 0.06, W / 2 + 0.06);
    this.addEdges(frameTop);
    this.roomGroup.add(frameTop);

    // ---------------------------
    // Frente + puerta
    // ---------------------------
    this.frontGroup.clear();

    const frontZ = W / 2 - t / 2;

    const frontWall = new THREE.Mesh(new THREE.BoxGeometry(L, H, t), matFront);
    frontWall.position.set(0, H / 2, frontZ);
    frontWall.castShadow = true;
    frontWall.receiveShadow = true;
    this.addEdges(frontWall);
    this.frontGroup.add(frontWall);

    // puerta (más realista: sin edges por defecto)
    const doorW = 0.9;
    const doorH = 1.9;
    const doorThickness = 0.08;

    const doorMat = this.makeDoorMaterial();
    (doorMat as any).envMapIntensity = 1.1;

    const hingeX = -L / 2 + 0.15;
    const hingeZ = W / 2 + doorThickness / 2;

    const doorGroup = new THREE.Group();
    doorGroup.position.set(hingeX, doorH / 2, hingeZ);
    this.frontGroup.add(doorGroup);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(doorW + 0.06, doorH + 0.06, 0.05),
      trimMat,
    );
    frame.position.set(doorW / 2, 0, -0.015);
    frame.castShadow = true;
    frame.receiveShadow = true;
    this.addEdges(frame);
    doorGroup.add(frame);

    const doorLeaf = new THREE.Mesh(
      new THREE.BoxGeometry(doorW, doorH, doorThickness),
      doorMat,
    );
    doorLeaf.position.set(doorW / 2, 0, 0);
    doorLeaf.castShadow = true;
    doorLeaf.receiveShadow = true;
    this.addEdges(doorLeaf);
    doorGroup.add(doorLeaf);

    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.16, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0x444444,
        metalness: 0.8,
        roughness: 0.25,
      }),
    );
    (handle.material as any).envMapIntensity = 1.2;
    handle.position.set(doorW - 0.15, 0.1, doorThickness / 2 + 0.02);
    handle.castShadow = true;
    doorGroup.add(handle);

    const threshold = new THREE.Mesh(
      new THREE.BoxGeometry(doorW + 0.05, 0.04, 0.12),
      trimMat,
    );
    threshold.position.set(hingeX + doorW / 2, 0.02, W / 2 + 0.06);
    threshold.receiveShadow = true;
    this.frontGroup.add(threshold);

    this.frontGroup.visible = this.frontVisible;
    this.roomGroup.add(this.frontGroup);
  }

  // ---------------------------------------------------------------------------
  // EQUIPOS (primitivas mejoradas + luz interior más real)
  // ---------------------------------------------------------------------------
  private buildEquipment() {
    const { length: L, width: W, height: H } = this.dims;

    // UNIDAD CONDENSADORA (techo)
    if (this.equip.roofCondenser) {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.6, 0.7),
        new THREE.MeshStandardMaterial({
          color: 0xdfe3e6,
          roughness: 0.55,
          metalness: 0.15,
        }),
      );
      (body.material as any).envMapIntensity = 1.0;
      body.position.set(0, H + 0.5, -W / 2 - 0.5);
      body.castShadow = true;
      body.receiveShadow = true;
      this.addEdges(body);
      this.equipGroup.add(body);

      const fan = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.06, 32),
        new THREE.MeshStandardMaterial({
          color: 0x222222,
          roughness: 0.6,
          metalness: 0.2,
        }),
      );
      (fan.material as any).envMapIntensity = 1.0;
      fan.rotation.x = Math.PI / 2;
      fan.position.set(0.35, H + 0.5, -W / 2 - 0.9);
      fan.castShadow = true;
      this.equipGroup.add(fan);

      this.loadModel('assets/models/outdoor_central_ac_air_condi', {
        position: new THREE.Vector3(0, H + 0.5, -W / 2 - 0.5),
        scale: 0.9,
        parent: this.equipGroup,
      });
    }

    // EVAPORADORES (interior)
    if (this.equip.evaporators) {
      const unitCount = 3;

      const evapMat = new THREE.MeshStandardMaterial({
        color: 0xe3e8ee,
        roughness: 0.5,
        metalness: 0.12,
      });
      (evapMat as any).envMapIntensity = 1.0;

      for (let i = 0; i < unitCount; i++) {
        const x = -L / 2 + 0.8 + i * ((L - 1.6) / (unitCount - 1));
        const y = H - 0.6;
        const z = W / 2 - 0.4;

        const evap = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 0.28, 0.28),
          evapMat,
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
            metalness: 0.7,
            roughness: 0.35,
          }),
        );
        (fan.material as any).envMapIntensity = 1.0;
        fan.rotation.z = Math.PI / 2;
        fan.position.set(x, y, z - 0.2);
        fan.castShadow = true;
        this.equipGroup.add(fan);

        this.loadModel('assets/models/evaporator', {
          position: new THREE.Vector3(x, y, z),
          rotation: new THREE.Euler(0, Math.PI, 0),
          scale: 0.7,
          parent: this.equipGroup,
        });
      }
    }

    // LUZ INTERIOR (panel emissive + pointLight físico)
    if (this.equip.interiorLight) {
      const y = H - 0.25;

      const lightPanelMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 2.2,
        roughness: 0.25,
        metalness: 0.0,
      });
      (lightPanelMat as any).envMapIntensity = 1.0;

      const lightPanel = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(1.4, L * 0.25), 0.35),
        lightPanelMat,
      );
      lightPanel.position.set(0, y, 0);
      lightPanel.rotation.x = Math.PI / 2;
      this.equipGroup.add(lightPanel);

      // con physicallyCorrectLights: intensidades grandes
      const bulb = new THREE.PointLight(0xffffff, 120, Math.max(L, W) * 2.0, 2);
      bulb.position.set(0, y - 0.12, 0);
      bulb.castShadow = true;
      bulb.shadow.mapSize.set(1024, 1024);
      bulb.shadow.bias = -0.0001;
      this.equipGroup.add(bulb);

      this.loadModel('assets/models/ceiling_lamp_10mb.glb', {
        position: new THREE.Vector3(0, y - 0.08, 0),
        parent: this.equipGroup,
      });
    }

    // TABLERO ELÉCTRICO
    if (this.equip.electricPanel) {
      const panelOffset = 0.22;
      const panelHeight = 1.4;

      const panelGroup = new THREE.Group();
      panelGroup.position.set(-L / 2 - panelOffset, panelHeight, W * 0.15);
      panelGroup.rotation.y = -Math.PI / 2;
      this.equipGroup.add(panelGroup);

      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.55, 0.14),
        new THREE.MeshStandardMaterial({
          color: 0xd9dde3,
          roughness: 0.45,
          metalness: 0.25,
        }),
      );
      (body.material as any).envMapIntensity = 1.0;
      body.castShadow = true;
      body.receiveShadow = true;
      this.addEdges(body);
      panelGroup.add(body);

      const door = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.5, 0.02),
        new THREE.MeshStandardMaterial({
          color: 0xf5f6f8,
          roughness: 0.35,
          metalness: 0.15,
        }),
      );
      (door.material as any).envMapIntensity = 1.0;
      door.position.set(0.03, 0, 0.07);
      door.castShadow = true;
      panelGroup.add(door);

      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(0.32, 0.44, 0.005),
        new THREE.MeshStandardMaterial({
          color: 0xe1e4ea,
          roughness: 0.45,
          metalness: 0.1,
        }),
      );
      (frame.material as any).envMapIntensity = 1.0;
      frame.position.set(0.035, 0, 0.082);
      panelGroup.add(frame);

      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.12, 0.03),
        new THREE.MeshStandardMaterial({
          color: 0x555555,
          metalness: 0.8,
          roughness: 0.25,
        }),
      );
      (handle.material as any).envMapIntensity = 1.2;
      handle.position.set(0.11, 0, 0.085);
      handle.castShadow = true;
      panelGroup.add(handle);

      const ledMat = (c: number) =>
        new THREE.MeshStandardMaterial({
          color: c,
          emissive: c,
          emissiveIntensity: 1.4,
          roughness: 0.35,
          metalness: 0.1,
        });

      const ledGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.01, 16);
      const ledY = 0.18;
      const ledZ = 0.085;

      const ledGreen = new THREE.Mesh(ledGeo, ledMat(0x6dd36b));
      ledGreen.rotation.x = Math.PI / 2;
      ledGreen.position.set(-0.04, ledY, ledZ);
      panelGroup.add(ledGreen);

      const ledYellow = new THREE.Mesh(ledGeo, ledMat(0xf3c969));
      ledYellow.rotation.x = Math.PI / 2;
      ledYellow.position.set(0, ledY, ledZ);
      panelGroup.add(ledYellow);

      const ledRed = new THREE.Mesh(ledGeo, ledMat(0xe66c6c));
      ledRed.rotation.x = Math.PI / 2;
      ledRed.position.set(0.04, ledY, ledZ);
      panelGroup.add(ledRed);

      this.loadModel('assets/models/electrical_panel.glb', {
        position: new THREE.Vector3(0, 0, 0),
        rotation: new THREE.Euler(0, Math.PI / 2, 0),
        scale: 0.6,
        parent: panelGroup,
      });
    }

    // RACKS (ejemplo)
    const rackY = 0;
    const rackZ = 0;
    const rackOffsetX = 0.9;

    this.loadModel('assets/models/rack', {
      position: new THREE.Vector3(-rackOffsetX, rackY, rackZ),
      scale: 0.8,
      parent: this.roomGroup,
    });
    this.loadModel('assets/models/rack', {
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
    if (maxDim <= 0) return;

    const distance = maxDim * 1.7;
    const heightCam = H * 0.95;

    this.camera.position.set(distance, heightCam, distance);
    this.controls.target.set(0, H / 2, 0);
    this.controls.update();

    this.controls.minDistance = maxDim * 0.55;
    this.controls.maxDistance = maxDim * 3.2;
    this.controls.maxPolarAngle = Math.PI / 2.05;
  }

  // ---------------------------------------------------------------------------
  // LOOP (usa composer si existe)
  // ---------------------------------------------------------------------------
  private loop = () => {
    this.animId = requestAnimationFrame(this.loop);
    this.controls.update();

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  };
}
