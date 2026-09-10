import { Component, Input, OnInit } from '@angular/core';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { take } from 'rxjs';
import { Member } from 'src/app/_models/member';
import { Photo } from 'src/app/_models/Photo';
import { User } from 'src/app/_models/user';
import { AccountService } from 'src/app/_services/account.service';
import { MembersService } from 'src/app/_services/members.service';
import { environment } from 'src/environments/environment';
import { NgFor, NgIf, NgClass, NgStyle } from '@angular/common';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

@Component({
    selector: 'app-photo-editor',
    templateUrl: './photo-editor.component.html',
    styleUrls: ['./photo-editor.component.css'],
    standalone: true,
    imports: [NgFor, NgIf, NgClass, NgStyle]
})
export class PhotoEditorComponent implements OnInit {

  @Input() member: Member;
  hasBaseDropzoneOver = false;
  baseUrl = environment.apiUrl;
  user: User;
  uploading = false;
  uploadProgress = 0;


  constructor(private accountService: AccountService, private memberService: MembersService,
    private http: HttpClient) {
    this.accountService.currentUser$.pipe(take(1)).subscribe(user => this.user = user);

  }

  ngOnInit(): void {
  }

  fileOverBase(e: any) {
    this.hasBaseDropzoneOver = e;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.hasBaseDropzoneOver = false;
    if (event.dataTransfer?.files) this.queueFiles(event.dataTransfer.files);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) this.queueFiles(input.files);
    input.value = '';
  }


  setMainPhoto(photo: Photo) {
    this.memberService.setMainPhoto(photo.id).subscribe(() => {
      this.user.photoUrl = photo.url;
      this.accountService.setCurrentUser(this.user);
      this.member.photoUrl = photo.url;
      this.member.photos.forEach(p => {
        if (p.isMain) p.isMain = false;
        if (p.id === photo.id) p.isMain = true;
      })
    })
  }

  deletePhoto(photoId: number) {
    this.memberService.deletePhoto(photoId).subscribe(() => {
      this.member.photos = this.member.photos.filter(x => x.id !== photoId);
    })
  }


  private queueFiles(fileList: FileList) {
    Array.from(fileList)
      .filter(file => file.type.startsWith('image/') && file.size <= MAX_FILE_SIZE)
      .forEach(file => this.uploadPhoto(file));
  }

  private uploadPhoto(file: File) {
    const formData = new FormData();
    formData.append('file', file);

    this.uploading = true;
    this.uploadProgress = 0;

    this.http.post<Photo>(this.baseUrl + 'users/add-photo', formData, {
      reportProgress: true,
      observe: 'events'
    }).subscribe({
      next: event => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.uploadProgress = Math.round(100 * event.loaded / event.total);
        } else if (event.type === HttpEventType.Response && event.body) {
          const photo = event.body;
          this.member.photos.push(photo);
          if (photo.isMain) {
            this.user.photoUrl = photo.url;
            this.member.photoUrl = photo.url;
            this.accountService.setCurrentUser(this.user);
          }
        }
      },
      error: () => {
        this.uploading = false;
        this.uploadProgress = 0;
      },
      complete: () => {
        this.uploading = false;
        this.uploadProgress = 0;
      }
    });
  }

}
