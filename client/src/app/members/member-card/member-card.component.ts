import { Component, Input, OnInit } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { Member } from 'src/app/_models/member';
import { MembersService } from 'src/app/_services/members.service';
import { PresenceService } from 'src/app/_services/presence.service';
import { AsyncPipe } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
    selector: 'app-member-card',
    templateUrl: './member-card.component.html',
    styleUrls: ['./member-card.component.css'],
    imports: [RouterLink, AsyncPipe]
})
export class MemberCardComponent implements OnInit {
  @Input() member:Member;
  constructor(private memberService: MembersService, private toastr: ToastrService,public presence: PresenceService) { }

  ngOnInit(): void {
  }
  addLike(member: Member) {
    this.memberService.addLike(member.username).subscribe(() => {
      this.toastr.success('You have liked ' + member.knownAs);
    })
  }

}
