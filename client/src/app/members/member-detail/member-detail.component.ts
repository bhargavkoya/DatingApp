import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TabDirective, TabsetComponent, TabsModule } from 'ngx-bootstrap/tabs';
import { take } from 'rxjs';
import { Member } from 'src/app/_models/member';
import { Message } from 'src/app/_models/Message';
import { User } from 'src/app/_models/user';
import { AccountService } from 'src/app/_services/account.service';
import { MembersService } from 'src/app/_services/members.service';
import { MessageService } from 'src/app/_services/message.service';
import { PresenceService } from 'src/app/_services/presence.service';
import { TimeagoPipe } from '../../_pipes/timeago.pipe';
import { MemberMessagesComponent } from '../member-messages/member-messages.component';
import { AsyncPipe, DatePipe } from '@angular/common';

@Component({
    selector: 'app-member-detail',
    templateUrl: './member-detail.component.html',
    styleUrls: ['./member-detail.component.css'],
    standalone: true,
    imports: [TabsModule, MemberMessagesComponent, AsyncPipe, DatePipe, TimeagoPipe]
})
export class MemberDetailComponent implements OnInit,OnDestroy {
  @ViewChild('memberTabs',{static:true}) memberTabs: TabsetComponent;
  member:Member;
  activePhotoUrl: string;
  activeTab:TabDirective;
  messages:Message[]=[];
  user:User;

  constructor(private memberService:MembersService,private route:ActivatedRoute,private messageService:MessageService,
    public presence: PresenceService,private accountService: AccountService) {
      this.accountService.currentUser$.pipe(take(1)).subscribe(user => this.user = user);

     }

  ngOnInit(): void {

    this.route.data.subscribe(data => {
      this.member = data.member;
      this.activePhotoUrl = this.member.photoUrl || this.member.photos?.[0]?.url;
    })

    this.route.queryParams.subscribe(params => {
      params.tab ? this.selectTab(params.tab) : this.selectTab(0);
    })


  }


  selectPhoto(url: string) {
    this.activePhotoUrl = url;
  }


  loadMessages() {
    this.messageService.getMessageThread(this.member.username).subscribe(messages => {
      this.messages = messages;
    })
  }

  selectTab(tabId: number) {
    this.memberTabs.tabs[tabId].active = true;
  }

  onTabActivated(data: TabDirective) {
    this.activeTab = data;
    if (this.activeTab.heading === 'Messages' && this.messages.length === 0) {
      this.messageService.createHubConnection(this.user, this.member.username);

    }else{
      this.messageService.stopHubConnection();
    }
  }

  ngOnDestroy(): void {
    this.messageService.stopHubConnection();
  }



}
