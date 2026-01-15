import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ColdRoomComponent } from './cold-room.component';

describe('ColdRoomComponent', () => {
  let component: ColdRoomComponent;
  let fixture: ComponentFixture<ColdRoomComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [ColdRoomComponent]
    });
    fixture = TestBed.createComponent(ColdRoomComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
