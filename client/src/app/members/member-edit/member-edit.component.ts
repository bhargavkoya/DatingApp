import { Component, HostListener, OnInit, ViewChild } from '@angular/core';
import { NgForm, FormsModule } from '@angular/forms';
import { ToastrService } from 'ngx-toastr';
import { take } from 'rxjs';
import { Member } from 'src/app/_models/member';
import { User } from 'src/app/_models/user';
import { AccountService } from 'src/app/_services/account.service';
import { MembersService } from 'src/app/_services/members.service';
import { TimeagoPipe } from '../../_pipes/timeago.pipe';
import { PhotoEditorComponent } from '../photo-editor/photo-editor.component';
import { TabsModule } from 'ngx-bootstrap/tabs';
import { DatePipe } from '@angular/common';

@Component({
    selector: 'app-member-edit',
    templateUrl: './member-edit.component.html',
    styleUrls: ['./member-edit.component.css'],
    standalone: true,
    imports: [TabsModule, FormsModule, PhotoEditorComponent, DatePipe, TimeagoPipe]
})
export class MemberEditComponent implements OnInit {
  member:Member;
  user:User;
  @ViewChild('editForm') editForm: NgForm;

  @HostListener('window:beforeunload', ['$event']) unloadNotification($event: any) {
    if (this.editForm.dirty) {
      $event.returnValue = true;
    }
  }

  constructor(private accountService:AccountService,private memberService:MembersService,private toasterService:ToastrService) {
    this.accountService.currentUser$.pipe(take(1)).subscribe(user=>this.user=user);
   }

  ngOnInit(): void {
    this.loadMember();
  }


  loadMember(){
    this.memberService.getMember(this.user.username).subscribe(member =>{
      this.member=member;
    })
  }

  updateMember(){
    this.memberService.updateMember(this.member).subscribe(() => {
      this.toasterService.success('Profile updated successfully');
      this.editForm.reset(this.member);
    })

    
  }
}
