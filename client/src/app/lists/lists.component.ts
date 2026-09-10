import { Component, OnInit } from '@angular/core';
import { Member } from '../_models/member';
import { Pagination } from '../_models/pagination';
import { MembersService } from '../_services/members.service';
import { PaginationModule } from 'ngx-bootstrap/pagination';
import { MemberCardComponent } from '../members/member-card/member-card.component';

import { FormsModule } from '@angular/forms';
import { ButtonsModule } from 'ngx-bootstrap/buttons';

@Component({
    selector: 'app-lists',
    templateUrl: './lists.component.html',
    styleUrls: ['./lists.component.css'],
    standalone: true,
    imports: [ButtonsModule, FormsModule, MemberCardComponent, PaginationModule]
})
export class ListsComponent implements OnInit {
 
  members: Partial<Member[]>;
  predicate = 'liked';
  pageNumber = 1;
  pageSize = 2;
  pagination: Pagination;


  constructor(private memberService:MembersService) { }

  ngOnInit(): void {
  }

  loadLikes(){
    this.memberService.getLikes(this.predicate,this.pageNumber,this.pageSize).subscribe(response=>{
      this.members=response.result;
      this.pagination=response.pagination;
    })
  }

  pageChanged(event: any) {
    this.pageNumber = event.page;
    this.loadLikes();
  }


}
